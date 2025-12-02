---
title: Importing a Mistral Model into Amazon Bedrock
description: How to bring our own Mistral model into Amazon Bedrock
category: infrastructure
order: 1
---

## 1. Purpose

This document describes **how to bring our own Mistral model into Amazon Bedrock** using **Custom Model Import**, so that:

* We can **serve the model via Bedrock’s serverless API** (no infra to manage).
* We can integrate it with Bedrock’s tooling (Guardrails, Knowledge Bases, Agents, etc.). ([Amazon Web Services, Inc.][1])

The flow we will follow:

> **Mistral weights → Hugging Face format → S3 → Bedrock Custom Model Import → Imported Model ARN → Used via Bedrock Runtime API**

---

## 2. Background & Scope

### 2.1 Amazon Bedrock + Mistral

Amazon Bedrock already offers **managed Mistral models** (Mistral 7B, Mixtral 8x7B, Mistral Small, Mistral Large) as fully managed endpoints. ([Amazon Web Services, Inc.][2])

Separately, **Custom Model Import** allows us to **import custom weights** for supported architectures like **Mistral / Mixtral** and use them as “imported models” in Bedrock. ([Amazon Web Services, Inc.][1])

### 2.2 Scope of this doc

This document covers:

* A **Mistral-based text generation model** (base or fine-tuned) that we already have (locally or in SageMaker).
* Importing it from **Amazon S3** into Bedrock as an **Imported Model**.
* Using the resulting model **via AWS Console + Bedrock Runtime API** (no SageMaker endpoints).

Out of scope:

* Training / fine-tuning process itself.
* Performance benchmarking and RLHF.
* Multimodal or embedding-only models.

---

## 3. High-level Architecture

**Data flow:**

1. **Model Preparation**

   * Ensure model uses a **supported architecture (Mistral/Mixtral)** and is stored in **Hugging Face format with safetensors**. ([AWS Documentation][3])

2. **Artifact Storage**

   * Upload model directory to **Amazon S3** in the same region where Bedrock Custom Model Import is available (e.g., `us-east-1`, `us-west-2`, `us-east-2`, `eu-central-1`). ([AWS Documentation][4])

3. **Import Job**

   * Create an **IAM role** with permissions for Bedrock to read S3.
   * Submit a **Model Import Job** via **Console** or **`CreateModelImportJob` API/CLI**. ([AWS Documentation][3])
   * Bedrock automatically detects the architecture and registers an **Imported Model**.

4. **Serving & Integration**

   * Use the **Imported Model ARN** as `modelId` in **Bedrock Runtime (`invoke_model` or `converse`)**.
   * Optionally attach **Guardrails, Knowledge Bases, Agents**, etc. ([Amazon Web Services, Inc.][1])

---

## 4. Prerequisites

### 4.1 AWS Environment

* AWS account with **access to Amazon Bedrock** in a supported region.
* **Bedrock Custom Model Import** available in our selected region (currently documented for `us-east-1`, `us-east-2`, `us-west-2`, `eu-central-1`). ([AWS Documentation][4])
* Ability to create:

  * **S3 bucket**
  * **IAM roles**
  * Optional: **SageMaker** (if we trained there).

### 4.2 Model Requirements (from Bedrock docs)

For S3-based import: ([AWS Documentation][3])

* Architecture must be **supported** (Mistral / Mixtral is supported).
* Model files must be in **Hugging Face format**:

  * Typical files:

    * `config.json`
    * `tokenizer.json` and/or `tokenizer.model`
    * `generation_config.json`
    * `model-00001-of-0000X.safetensors`, etc.
* **Model weights format**: `safetensors`.
* For S3 import, model files must be **uncompressed**, in an S3 **prefix (folder)**, *not* a `.zip` or `.tar`.
* Typical constraints from docs:

  * Text models: total weights size **< ~200 GB**.
  * Context length **< 128K** tokens.
  * Compatible with **`transformers` version expected by Bedrock** (AWS currently documents 4.51.x for examples).

If model is not already in HF format:

* AWS docs specifically say: *“If your model is a Mistral AI model, use `convert_mistral_weights_to_hf.py`.”* ([AWS Documentation][3])

### 4.3 Licensing

* Ensure our use of Mistral weights and our fine-tuning is **compatible with the Mistral license** and **AWS terms**. ([AWS Documentation][4])

---

## 5. Step 1 – Prepare the Mistral Model

### 5.1 Convert to Hugging Face + safetensors (if needed)

If we start from raw Mistral weights:

1. Use the Mistral/HF conversion script (`convert_mistral_weights_to_hf.py`) as per AWS docs for S3 imports. ([AWS Documentation][3])
2. Confirm that the resulting directory contains:

   * `config.json`
   * tokenizer files
   * `generation_config.json`
   * `model-*.safetensors` shards.

If we fine-tuned with **LoRA/PEFT**:

* **Merge adapters** back into the base model before import and save as HF `safetensors` (this is the pattern used in AWS’ Mistral QA import example). ([The AWS News Feed][5])

### 5.2 Folder structure example

```text
mistral-7b-custom/
  config.json
  generation_config.json
  tokenizer.json
  tokenizer.model          # (depending on tokenizer)
  special_tokens_map.json  # optional
  model-00001-of-00003.safetensors
  model-00002-of-00003.safetensors
  model-00003-of-00003.safetensors
```

---

## 6. Step 2 – Upload Model to Amazon S3

1. Create or choose an **S3 bucket** in the **same region** as Bedrock.
2. Upload the **entire HF directory** without compression, e.g.:

```bash
aws s3 cp \
  ./mistral-7b-custom/ \
  s3://<our-bucket>/models/mistral-7b-custom/ \
  --recursive
```

3. Record the **S3 URI**:

```text
s3://<our-bucket>/models/mistral-7b-custom/
```

We will use this S3 URI in the Bedrock import job. ([AWS Documentation][3])

---

## 7. Step 3 – IAM Role for Model Import

AWS requires a **service role** that Bedrock will assume for reading model artifacts. ([AWS Documentation][6])

### 7.1 Trust Policy (Bedrock principal)

Example trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "bedrock.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

### 7.2 Permissions Policy

Minimal permissions:

* `s3:GetObject` and `s3:ListBucket` on our model path.
* If objects are KMS-encrypted, `kms:Decrypt` on the CMK.

Example policy snippet (simplified):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowReadModelArtifacts",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::<our-bucket>",
        "arn:aws:s3:::<our-bucket>/models/mistral-7b-custom/*"
      ]
    }
  ]
}
```

Attach this to a role like:

```text
arn:aws:iam::<ACCOUNT_ID>:role/BedrockModelImportRole
```

The console can also **auto-create** a compliant role when we run the import wizard. ([AWS Documentation][3])

---

## 8. Step 4 – Submit Model Import Job

We can do this either from the **Console** or via **CLI/SDK**.

### 8.1 Console Flow

From the AWS docs & blogs: ([AWS Documentation][3])

1. Open the **Amazon Bedrock console** in the target region.
2. In the left navigation, under **Foundation models**, click **Imported models**.
3. Click **Import model**.
4. Fill in:

   * **Model name** – e.g. `mistral-7b-support-bot`.
   * **Import source**:

     * Choose **Amazon S3 bucket**.
     * Select/browse to `s3://<our-bucket>/models/mistral-7b-custom/`.
5. **Service access**:

   * Select existing `BedrockModelImportRole` or **create a new one**.
6. Submit the job.
7. Monitor the job until status becomes **Completed**.
8. The model will appear in **Imported models** with an **Imported model ID / ARN**.

### 8.2 CLI – `create-model-import-job`

From the Bedrock API docs: ([AWS Documentation][6])

```bash
aws bedrock create-model-import-job \
  --region us-east-1 \
  --job-name "mistral-7b-import-$(date +%Y%m%d-%H%M%S)" \
  --imported-model-name "mistral-7b-support-bot" \
  --role-arn "arn:aws:iam::<ACCOUNT_ID>:role/BedrockModelImportRole" \
  --model-data-source '{
    "s3DataSource": {
      "s3Uri": "s3://<our-bucket>/models/mistral-7b-custom/"
    }
  }'
```

To check job status: ([boto3.amazonaws.com][7])

```bash
aws bedrock get-model-import-job \
  --region us-east-1 \
  --job-identifier "<job-id-from-create-response>"
```

When the job finishes, the response will contain a reference to the **imported model ARN**, e.g.:

```text
arn:aws:bedrock:us-east-1:<ACCOUNT_ID>:imported-model/mistral-7b-support-bot-xxxxxx
```

---

## 9. Step 5 – Use the Imported Mistral Model

### 9.1 In the Bedrock console

1. Go to **Playgrounds → Chat or Text**.
2. **Select model** → Category: **Imported models**.
3. Choose `mistral-7b-support-bot` and throughput **On-demand**.
4. Test prompts interactively. ([CloudThat][8])

### 9.2 Programmatic usage (Python / boto3)

Using **Bedrock Runtime** (`invoke_model`): ([AWS Documentation][4])

```python
import boto3, json

bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")

model_id = "arn:aws:bedrock:us-east-1:<ACCOUNT_ID>:imported-model/mistral-7b-support-bot-xxxxxx"

payload = {
    "prompt": "You are a helpful assistant. Answer concisely.\n\nUser: Explain what our support policy covers.\nAssistant:",
    "max_tokens": 512,
    "temperature": 0.2,
    "top_p": 0.9
}

resp = bedrock.invoke_model(
    modelId=model_id,
    body=json.dumps(payload),
    contentType="application/json",
    accept="application/json"
)

result = json.loads(resp["body"].read())
print(result)
```

We can also use the **Converse API** for multi-turn dialogs and streaming.

---

## 10. Security & Operations Considerations

### 10.1 Cost model

From AWS’ description of Custom Model Import: ([Amazon Web Services, Inc.][1])

* **Import job itself is free**; we pay for:

  * **On-demand model throughput** (billed per active model “copies” in 5-minute windows).
  * **Token usage** for inference calls.

We should:

* Define **max concurrent throughput** based on expected traffic.
* Set up **CloudWatch metrics & alarms** on Bedrock usage and cost.

### 10.2 Data security

* Use **S3 bucket policies** to restrict access to model artifacts.
* If using **KMS**, ensure the import role has `kms:Decrypt`.
* Confirm compliance with Mistral’s license; restrict external sharing of weights.

### 10.3 Monitoring & lifecycle

* Track model import jobs via `get-model-import-job`. ([boto3.amazonaws.com][7])
* Regularly review:

  * **Imported models** list in Bedrock console.
  * **CloudWatch logs** for Bedrock runtime calls.
* For deprecation/cleanup, use the **delete imported model** API from the code samples. ([AWS Documentation][9])

---

[1]: https://aws.amazon.com/bedrock/custom-model-import/?utm_source=chatgpt.com "Amazon Bedrock Custom Model Import - AWS"
[2]: https://aws.amazon.com/bedrock/mistral/?utm_source=chatgpt.com "Mistral AI - Models in Amazon Bedrock – AWS"
[3]: https://docs.aws.amazon.com/bedrock/latest/userguide/model-customization-import-model-job.html?utm_source=chatgpt.com "Submit a model import job - Amazon Bedrock"
[4]: https://docs.aws.amazon.com/bedrock/latest/userguide/model-customization-import-model.html?utm_source=chatgpt.com "Use Custom model import to import a customized open ..."
[5]: https://aws-news.com/article/019244ac-db8d-3868-f4eb-a8d8f50f3df0?utm_source=chatgpt.com "Import a question answering fine-tuned model into Amazon ..."
[6]: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_CreateModelImportJob.html?utm_source=chatgpt.com "CreateModelImportJob - Amazon Bedrock"
[7]: https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/bedrock/client/get_model_import_job.html?utm_source=chatgpt.com "get_model_import_job - Boto3 1.40.73 documentation"
[8]: https://www.cloudthat.com/resources/blog/simplify-generative-ai-with-amazon-bedrock-and-custom-model-import/?utm_source=chatgpt.com "Simplify Generative AI with Amazon Bedrock and Custom ..."
[9]: https://docs.aws.amazon.com/bedrock/latest/userguide/custom-model-import-code-samples.html?utm_source=chatgpt.com "Code samples for custom model import - Amazon Bedrock"
