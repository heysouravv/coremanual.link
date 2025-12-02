---
title: Building Data Pipelines with Apache Airflow
description: A comprehensive guide to setting up and managing data pipelines using Apache Airflow on AWS
category: Data Engineering
order: 1
---

## 1. Purpose

This document describes **how to build and manage data pipelines using Apache Airflow** on AWS infrastructure, enabling:

* **Orchestration** of complex data workflows with dependencies
* **Scheduling** of batch and streaming data jobs
* **Monitoring** and alerting for pipeline failures
* **Scalability** through distributed task execution

The typical architecture:

> **Source Systems → Airflow DAGs → ETL Tasks → Data Warehouse/Lake → Analytics & Reporting**

---

## 2. Background & Scope

### 2.1 Apache Airflow Overview

Apache Airflow is an open-source platform for programmatically authoring, scheduling, and monitoring workflows. It uses **Directed Acyclic Graphs (DAGs)** to define task dependencies and execution order.

Key features:

* **Python-based** DAG definitions
* **Rich UI** for monitoring and debugging
* **Extensible** with custom operators and hooks
* **Integration** with AWS services (S3, EMR, Redshift, etc.)

### 2.2 Scope of this doc

This document covers:

* Setting up **Airflow on AWS** (ECS, EKS, or MWAA)
* Creating **DAGs** for common data engineering patterns
* **Best practices** for pipeline design
* **Monitoring and alerting** strategies

Out of scope:

* Airflow installation on local machines
* Advanced custom operator development
* Multi-cloud deployments

---

## 3. Architecture Options

### 3.1 Managed Workflows for Apache Airflow (MWAA)

**AWS Managed Service** - Recommended for most use cases:

* **Fully managed** - No infrastructure to maintain
* **Automatic scaling** based on workload
* **Integrated** with AWS IAM, VPC, CloudWatch
* **Cost-effective** for production workloads

### 3.2 Self-Managed on ECS/EKS

For more control and customization:

* **ECS Fargate** - Serverless container execution
* **EKS** - Kubernetes-based deployment
* **Custom configurations** and plugins
* **Higher operational overhead**

---

## 4. Prerequisites

### 4.1 AWS Environment

* AWS account with appropriate permissions
* **VPC** configured for Airflow networking
* **S3 bucket** for DAG storage and logs
* **IAM roles** for Airflow service access

### 4.2 Access Requirements

* Ability to create:
  * **MWAA environment** (or ECS/EKS cluster)
  * **RDS/PostgreSQL** for Airflow metadata database
  * **S3 buckets** for DAGs and logs
  * **IAM roles and policies**

---

## 5. Step 1 – Set Up MWAA Environment

### 5.1 Create S3 Bucket for DAGs

```bash
aws s3 mb s3://airflow-dags-<account-id> --region us-east-1
aws s3 mb s3://airflow-logs-<account-id> --region us-east-1
```

### 5.2 Create MWAA Environment

Via AWS Console:

1. Navigate to **Amazon MWAA** in AWS Console
2. Click **Create environment**
3. Configure:
   * **Environment name**: `production-airflow`
   * **DAGs S3 path**: `s3://airflow-dags-<account-id>/dags`
   * **Plugins S3 path**: `s3://airflow-dags-<account-id>/plugins`
   * **Requirements file**: `s3://airflow-dags-<account-id>/requirements.txt`
   * **Execution role**: IAM role with necessary permissions
   * **Network**: VPC and subnets
   * **Web server access**: Public or VPC-only

### 5.3 IAM Role Permissions

The execution role needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::airflow-dags-*",
        "arn:aws:s3:::airflow-dags-*/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

---

## 6. Step 2 – Create Your First DAG

### 6.1 Basic DAG Structure

Create `example_dag.py`:

```python
from airflow import DAG
from airflow.operators.python import PythonOperator
from datetime import datetime, timedelta

default_args = {
    'owner': 'data-engineering',
    'depends_on_past': False,
    'email_on_failure': True,
    'email_on_retry': False,
    'retries': 2,
    'retry_delay': timedelta(minutes=5),
}

with DAG(
    'example_data_pipeline',
    default_args=default_args,
    description='Example data pipeline DAG',
    schedule_interval=timedelta(days=1),
    start_date=datetime(2024, 1, 1),
    catchup=False,
    tags=['example', 'etl'],
) as dag:

    def extract_data():
        """Extract data from source"""
        print("Extracting data...")
        return "extracted_data"

    def transform_data(**context):
        """Transform extracted data"""
        data = context['ti'].xcom_pull(task_ids='extract')
        print(f"Transforming {data}...")
        return "transformed_data"

    def load_data(**context):
        """Load transformed data to destination"""
        data = context['ti'].xcom_pull(task_ids='transform')
        print(f"Loading {data}...")

    extract = PythonOperator(
        task_id='extract',
        python_callable=extract_data,
    )

    transform = PythonOperator(
        task_id='transform',
        python_callable=transform_data,
    )

    load = PythonOperator(
        task_id='load',
        python_callable=load_data,
    )

    extract >> transform >> load
```

### 6.2 Upload DAG to S3

```bash
aws s3 cp example_dag.py s3://airflow-dags-<account-id>/dags/
```

The DAG will appear in the Airflow UI within 1-2 minutes.

---

## 7. Step 3 – Common Data Engineering Patterns

### 7.1 S3 to Redshift ETL

```python
from airflow.providers.amazon.aws.operators.s3_to_redshift import S3ToRedshiftOperator

s3_to_redshift = S3ToRedshiftOperator(
    task_id='s3_to_redshift',
    schema='public',
    table='staging_table',
    s3_bucket='data-lake-bucket',
    s3_key='raw-data/{{ ds }}/',
    aws_conn_id='aws_default',
    redshift_conn_id='redshift_default',
    copy_options=["CSV", "IGNOREHEADER 1"],
)
```

### 7.2 EMR Spark Job

```python
from airflow.providers.amazon.aws.operators.emr import EmrAddStepsOperator

spark_step = EmrAddStepsOperator(
    task_id='run_spark_job',
    job_flow_id='j-XXXXXXXXXXXXX',
    aws_conn_id='aws_default',
    steps=[{
        'Name': 'Process Data',
        'ActionOnFailure': 'CONTINUE',
        'HadoopJarStep': {
            'Jar': 'command-runner.jar',
            'Args': [
                'spark-submit',
                '--deploy-mode', 'cluster',
                's3://scripts-bucket/process_data.py'
            ]
        }
    }],
)
```

---

## 8. Step 4 – Monitoring and Alerting

### 8.1 CloudWatch Metrics

MWAA automatically sends metrics to CloudWatch:

* `EnvironmentHealth` - Overall environment health
* `SchedulerHeartbeat` - Scheduler activity
* `DAGProcessingTime` - Time to process DAGs
* `TaskInstanceCount` - Number of task instances

### 8.2 Set Up Alarms

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name airflow-dag-failure \
  --alarm-description "Alert on DAG failures" \
  --metric-name TaskInstanceCount \
  --namespace AWS/MWAA \
  --statistic Sum \
  --period 300 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1
```

### 8.3 Email Notifications

Configure in DAG `default_args`:

```python
default_args = {
    'email': ['data-engineering@company.com'],
    'email_on_failure': True,
    'email_on_retry': False,
}
```

---

## 9. Best Practices

### 9.1 DAG Design

* **Idempotency**: Tasks should be safe to re-run
* **Atomicity**: Each task should do one thing well
* **Failure handling**: Use retries and proper error handling
* **Resource management**: Set appropriate resource limits

### 9.2 Performance Optimization

* **Parallel execution**: Use `max_active_tasks` wisely
* **Task grouping**: Combine small tasks when possible
* **Caching**: Use XCom for intermediate results
* **Resource pools**: Configure pools for resource-intensive tasks

### 9.3 Security

* **Secrets management**: Use AWS Secrets Manager or Airflow Variables
* **IAM roles**: Use least-privilege IAM roles per task
* **VPC isolation**: Run Airflow in private subnets
* **Encryption**: Enable encryption at rest and in transit

---

## 10. Troubleshooting

### 10.1 Common Issues

**DAGs not appearing:**
* Check S3 bucket permissions
* Verify DAG syntax (no Python errors)
* Check Airflow logs for parsing errors

**Tasks failing:**
* Review task logs in Airflow UI
* Check IAM permissions for AWS resources
* Verify network connectivity (VPC, security groups)

**Performance issues:**
* Monitor worker utilization
* Adjust `parallelism` and `dag_concurrency` settings
* Review task execution times

---

## 11. References

* [Apache Airflow Documentation](https://airflow.apache.org/docs/)
* [AWS MWAA User Guide](https://docs.aws.amazon.com/mwaa/)
* [Airflow Best Practices](https://airflow.apache.org/docs/apache-airflow/stable/best-practices.html)

