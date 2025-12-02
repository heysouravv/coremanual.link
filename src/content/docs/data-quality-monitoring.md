---
title: Data Quality Monitoring and Validation
description: Implementing data quality checks, monitoring, and validation pipelines
category: Data Engineering
order: 4
---

## 1. Purpose

This document describes **how to implement data quality monitoring and validation** in data pipelines, enabling:

* **Early detection** of data quality issues
* **Automated validation** of data at each pipeline stage
* **Monitoring and alerting** on quality metrics
* **Data lineage** tracking and impact analysis

The typical flow:

> **Data Ingestion → Quality Checks → Validation Rules → Monitoring Dashboard → Alerts & Remediation**

---

## 2. Background & Scope

### 2.1 Data Quality Dimensions

Common quality dimensions to monitor:

* **Completeness** - Are all expected records present?
* **Accuracy** - Is data correct and valid?
* **Consistency** - Is data consistent across sources?
* **Timeliness** - Is data arriving on schedule?
* **Validity** - Does data conform to schema/rules?
* **Uniqueness** - Are there duplicate records?

### 2.2 Scope of this doc

This document covers:

* **Data quality frameworks** and tools
* **Validation rules** and check implementation
* **Monitoring** with Great Expectations, dbt, or custom solutions
* **Alerting** strategies for quality issues
* **Remediation** workflows

Out of scope:

* Data governance policies
* Master data management
* Advanced ML-based anomaly detection

---

## 3. Architecture Options

### 3.1 Great Expectations

**Open-source framework:**
* **Declarative** validation rules
* **Rich reporting** and documentation
* **Integration** with data pipelines
* **Data profiling** capabilities

### 3.2 dbt Tests

**SQL-based testing:**
* **Built into dbt** - No separate tool needed
* **SQL-based** - Easy for SQL users
* **Integrated** with dbt models
* **Limited** to SQL-expressible checks

### 3.3 Custom Validation

**Python-based solutions:**
* **Full control** over validation logic
* **Custom integrations** with existing tools
* **Flexible** but more maintenance

---

## 4. Prerequisites

### 4.1 Environment Setup

* Python environment (for Great Expectations or custom)
* **dbt** installed (if using dbt tests)
* **Access** to data sources (S3, databases, etc.)
* **Monitoring infrastructure** (CloudWatch, Datadog, etc.)

### 4.2 Data Access

* Read access to **source data**
* Write access to **quality metrics storage**
* Ability to create **alerts and notifications**

---

## 5. Step 1 – Set Up Great Expectations

### 5.1 Installation

```bash
pip install great-expectations
```

### 5.2 Initialize Project

```bash
great_expectations init
```

This creates:
* `great_expectations/` directory
* Configuration files
* Example expectations

### 5.3 Create Data Source

```python
import great_expectations as gx

context = gx.get_context()

# Connect to S3 data
datasource = context.sources.add_pandas_s3(
    name="s3_datasource",
    bucket="data-lake-bucket",
    boto3_options={}
)

# Create data asset
data_asset = datasource.add_csv_asset(
    name="user_events",
    batching_regex=r"user-events/.*\.csv"
)
```

---

## 6. Step 2 – Define Validation Rules

### 6.1 Basic Expectations

```python
# Create expectation suite
suite = context.add_expectation_suite("user_events_suite")

# Define expectations
validator = context.get_validator(
    batch_request=data_asset.build_batch_request(),
    expectation_suite_name="user_events_suite"
)

# Column expectations
validator.expect_column_values_to_not_be_null("user_id")
validator.expect_column_values_to_be_unique("event_id")
validator.expect_column_values_to_be_between("amount", min_value=0, max_value=10000)

# Table-level expectations
validator.expect_table_row_count_to_be_between(min_value=1000, max_value=1000000)
validator.expect_table_column_count_to_equal(10)
```

### 6.2 Advanced Expectations

```python
# Referential integrity
validator.expect_column_pair_values_A_to_be_greater_than_B(
    column_A="end_time",
    column_B="start_time"
)

# Value set membership
validator.expect_column_values_to_be_in_set(
    "status",
    value_set=["active", "inactive", "pending"]
)

# Regex patterns
validator.expect_column_values_to_match_regex(
    "email",
    regex=r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
)

# Statistical expectations
validator.expect_column_mean_to_be_between(
    "revenue",
    min_value=100.0,
    max_value=1000.0
)
```

### 6.3 Save Expectations

```python
validator.save_expectation_suite(discard_failed_expectations=False)
```

---

## 7. Step 3 – Run Validations

### 7.1 Programmatic Validation

```python
# Run validation
checkpoint = context.add_or_update_checkpoint(
    name="user_events_checkpoint",
    validations=[
        {
            "batch_request": data_asset.build_batch_request(),
            "expectation_suite_name": "user_events_suite"
        }
    ]
)

# Execute checkpoint
results = checkpoint.run()
```

### 7.2 Integration with Airflow

```python
from airflow import DAG
from airflow.operators.python import PythonOperator
from great_expectations.checkpoint import Checkpoint

def validate_data():
    context = gx.get_context()
    checkpoint = Checkpoint(
        name="user_events_checkpoint",
        data_context=context
    )
    results = checkpoint.run()
    
    if not results.success:
        raise ValueError("Data quality checks failed")

validate_task = PythonOperator(
    task_id='validate_data',
    python_callable=validate_data,
    dag=dag
)
```

### 7.3 CLI Execution

```bash
great_expectations checkpoint run user_events_checkpoint
```

---

## 8. Step 4 – dbt Tests

### 8.1 Built-in Tests

In `schema.yml`:

```yaml
models:
  - name: stg_users
    columns:
      - name: user_id
        tests:
          - not_null
          - unique
      
      - name: email
        tests:
          - not_null
          - accepted_values:
              values: ['@company.com', '@partner.com']
      
      - name: created_at
        tests:
          - not_null
          - dbt_utils.expression_is_true:
              expression: "created_at <= current_timestamp"
```

### 8.2 Custom Tests

Create `tests/assert_positive_revenue.sql`:

```sql
SELECT *
FROM {{ ref('sales_fact') }}
WHERE revenue < 0
```

Run tests:

```bash
dbt test --select stg_users
```

### 8.3 Test Results

dbt stores test results in:
* `target/run_results.json`
* Can be integrated with monitoring tools

---

## 9. Step 5 – Monitoring and Alerting

### 9.1 Store Quality Metrics

Create metrics table:

```sql
CREATE TABLE data_quality_metrics (
    check_id VARCHAR(255),
    check_name VARCHAR(255),
    table_name VARCHAR(255),
    check_timestamp TIMESTAMP,
    passed BOOLEAN,
    records_checked BIGINT,
    records_failed BIGINT,
    failure_rate DECIMAL(5,2),
    details JSONB
);
```

### 9.2 Publish Metrics

```python
import boto3
import json
from datetime import datetime

def publish_quality_metrics(results):
    """Publish quality metrics to CloudWatch"""
    cloudwatch = boto3.client('cloudwatch')
    
    for result in results:
        cloudwatch.put_metric_data(
            Namespace='DataQuality',
            MetricData=[
                {
                    'MetricName': f"{result['table']}.{result['check']}",
                    'Value': 1 if result['passed'] else 0,
                    'Unit': 'Count',
                    'Timestamp': datetime.utcnow()
                },
                {
                    'MetricName': f"{result['table']}.failure_rate",
                    'Value': result['failure_rate'],
                    'Unit': 'Percent',
                    'Timestamp': datetime.utcnow()
                }
            ]
        )
```

### 9.3 Set Up Alerts

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name data-quality-failure \
  --alarm-description "Alert on data quality check failures" \
  --metric-name data_quality.passed \
  --namespace DataQuality \
  --statistic Minimum \
  --period 300 \
  --threshold 1 \
  --comparison-operator LessThanThreshold \
  --evaluation-periods 1
```

### 9.4 Dashboard

Create CloudWatch dashboard:

```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["DataQuality", "user_events.completeness", {"stat": "Average"}],
          ["DataQuality", "user_events.validity", {"stat": "Average"}]
        ],
        "period": 300,
        "stat": "Average",
        "region": "us-east-1",
        "title": "Data Quality Metrics"
      }
    }
  ]
}
```

---

## 10. Step 6 – Remediation Workflows

### 10.1 Automatic Remediation

For common issues:

```python
def remediate_duplicates(table_name):
    """Remove duplicate records"""
    query = f"""
    DELETE FROM {table_name}
    WHERE id IN (
        SELECT id
        FROM (
            SELECT id,
                   ROW_NUMBER() OVER (PARTITION BY unique_key ORDER BY created_at DESC) as rn
            FROM {table_name}
        ) t
        WHERE rn > 1
    )
    """
    execute_query(query)
```

### 10.2 Manual Review Queue

For issues requiring human review:

```python
def create_review_ticket(issue):
    """Create ticket for manual review"""
    ticket = {
        'table': issue['table'],
        'check': issue['check'],
        'failed_records': issue['failed_records'],
        'severity': issue['severity'],
        'created_at': datetime.utcnow()
    }
    
    # Send to ticketing system (Jira, ServiceNow, etc.)
    create_ticket(ticket)
```

### 10.3 Data Lineage Tracking

Track data flow for impact analysis:

```python
class DataLineage:
    def __init__(self):
        self.lineage_graph = {}
    
    def add_dependency(self, source, target, transformation):
        if target not in self.lineage_graph:
            self.lineage_graph[target] = []
        self.lineage_graph[target].append({
            'source': source,
            'transformation': transformation
        })
    
    def get_downstream_impact(self, table):
        """Get all tables that depend on this table"""
        impacted = []
        for target, deps in self.lineage_graph.items():
            if any(dep['source'] == table for dep in deps):
                impacted.append(target)
        return impacted
```

---

## 11. Best Practices

### 11.1 Validation Strategy

* **Validate early** - Check data at ingestion
* **Validate often** - Run checks after each transformation
* **Fail fast** - Stop pipeline on critical failures
* **Document rules** - Keep expectations documented and versioned

### 11.2 Performance

* **Sample data** - For large datasets, validate samples
* **Parallel execution** - Run independent checks in parallel
* **Incremental checks** - Only validate new/changed data when possible
* **Cache results** - Store validation results for reporting

### 11.3 Alerting

* **Tiered alerts** - Different severity levels
* **Avoid alert fatigue** - Only alert on actionable issues
* **Context in alerts** - Include enough info for troubleshooting
* **Escalation** - Define escalation paths for critical issues

---

## 12. References

* [Great Expectations Documentation](https://docs.greatexpectations.io/)
* [dbt Testing Documentation](https://docs.getdbt.com/docs/build/tests)
* [Data Quality Best Practices](https://www.datacamp.com/tutorial/data-quality)

