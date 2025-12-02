---
title: Lakehouse Architecture with Delta Lake
description: Building modern data lakehouses using Delta Lake on AWS for unified analytics
category: Data Engineering
order: 5
---

## 1. Purpose

This document describes **how to build a lakehouse architecture using Delta Lake** on AWS, enabling:

* **Unified storage** for both batch and streaming data
* **ACID transactions** on data lakes
* **Time travel** and versioning capabilities
* **Schema evolution** without breaking changes
* **Performance optimization** through file management

The typical architecture:

> **Data Sources → Delta Lake (S3) → Spark/Databricks → Analytics & ML → BI Tools**

---

## 2. Background & Scope

### 2.1 Lakehouse Concept

A **lakehouse** combines the best of data lakes and data warehouses:

* **Data lake benefits**: Low-cost storage, schema-on-read, diverse data types
* **Data warehouse benefits**: ACID transactions, schema enforcement, query performance

**Delta Lake** provides:
* **ACID transactions** on cloud storage
* **Time travel** for data versioning
* **Upserts and deletes** on data lakes
* **Schema enforcement and evolution**

### 2.2 Scope of this doc

This document covers:

* Setting up **Delta Lake on S3**
* **Writing and reading** Delta tables
* **Schema management** and evolution
* **Optimization** techniques (Z-ordering, compaction)
* **Integration** with Spark and Databricks

Out of scope:

* Databricks-specific features (Unity Catalog, etc.)
* Multi-cloud deployments
* Advanced ML workflows

---

## 3. Architecture Options

### 3.1 Delta Lake on EMR

**Self-managed Spark clusters:**
* **Full control** over cluster configuration
* **Cost-effective** for predictable workloads
* **Integration** with existing AWS services

### 3.2 Databricks on AWS

**Managed Spark platform:**
* **Fully managed** - No cluster management
* **Optimized** for Delta Lake
* **Advanced features** (Unity Catalog, Delta Sharing)
* **Higher cost** but less operational overhead

### 3.3 Serverless (Glue + Delta)

**AWS Glue with Delta support:**
* **Serverless** - Pay per job
* **Integrated** with AWS ecosystem
* **Limited** Delta Lake features

---

## 4. Prerequisites

### 4.1 AWS Environment

* AWS account with appropriate permissions
* **S3 bucket** for Delta tables
* **EMR cluster** or Databricks workspace
* Understanding of **Spark** and **Parquet** format

### 4.2 Access Requirements

* Ability to create:
  * **S3 buckets** for Delta storage
  * **EMR clusters** (or Databricks workspace)
  * **IAM roles** for S3 and Glue access
  * **Glue Data Catalog** (optional, for metadata)

---

## 5. Step 1 – Set Up Delta Lake

### 5.1 Install Delta Lake

For **EMR**, Delta Lake is included in EMR 6.3+:

```bash
# Create EMR cluster with Delta support
aws emr create-cluster \
  --name "delta-lake-cluster" \
  --release-label emr-6.15.0 \
  --applications Name=Spark Name=Hadoop \
  --instance-type m5.xlarge \
  --instance-count 3 \
  --ec2-attributes KeyName=your-key-pair \
  --use-default-roles
```

For **local development**:

```bash
pip install delta-spark
```

### 5.2 Initialize Spark with Delta

```python
from pyspark.sql import SparkSession
from delta import configure_spark_with_delta_pip

builder = SparkSession.builder \
    .appName("DeltaLakeApp") \
    .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension") \
    .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog")

spark = configure_spark_with_delta_pip(builder).getOrCreate()
```

---

## 6. Step 2 – Create Delta Tables

### 6.1 Write Data as Delta

```python
# Read from source
df = spark.read.parquet("s3://source-bucket/data/")

# Write as Delta table
df.write \
    .format("delta") \
    .mode("overwrite") \
    .save("s3://delta-bucket/tables/users/")
```

### 6.2 Create Managed Table

```python
# Write and register in catalog
df.write \
    .format("delta") \
    .mode("overwrite") \
    .option("path", "s3://delta-bucket/tables/users/") \
    .saveAsTable("users")
```

### 6.3 Create External Table

```python
spark.sql("""
    CREATE TABLE users
    USING DELTA
    LOCATION 's3://delta-bucket/tables/users/'
""")
```

### 6.4 Schema Definition

```python
from pyspark.sql.types import StructType, StructField, StringType, IntegerType, TimestampType

schema = StructType([
    StructField("user_id", IntegerType(), False),
    StructField("email", StringType(), True),
    StructField("created_at", TimestampType(), True),
    StructField("status", StringType(), True)
])

df = spark.createDataFrame([], schema)

df.write \
    .format("delta") \
    .mode("overwrite") \
    .save("s3://delta-bucket/tables/users/")
```

---

## 7. Step 3 – Read and Query Delta Tables

### 7.1 Read Delta Table

```python
# Read latest version
df = spark.read.format("delta").load("s3://delta-bucket/tables/users/")

# Or using SQL
df = spark.sql("SELECT * FROM delta.`s3://delta-bucket/tables/users/`")
```

### 7.2 Time Travel

Read previous versions:

```python
# Read version 5
df = spark.read.format("delta") \
    .option("versionAsOf", 5) \
    .load("s3://delta-bucket/tables/users/")

# Read timestamp
df = spark.read.format("delta") \
    .option("timestampAsOf", "2024-01-15 10:00:00") \
    .load("s3://delta-bucket/tables/users/")
```

### 7.3 Query History

```python
from delta.tables import DeltaTable

delta_table = DeltaTable.forPath(spark, "s3://delta-bucket/tables/users/")

# Get history
history = delta_table.history()
history.show()
```

---

## 8. Step 4 – Updates and Deletes

### 8.1 Update Records

```python
from delta.tables import DeltaTable

delta_table = DeltaTable.forPath(spark, "s3://delta-bucket/tables/users/")

# Update matching records
delta_table.update(
    condition="status = 'inactive'",
    set={"status": "'archived'"}
)
```

### 8.2 Upsert (Merge)

```python
# New/updated data
updates_df = spark.createDataFrame([
    (1, "user1@example.com", "active"),
    (2, "user2@example.com", "active"),
], ["user_id", "email", "status"])

# Merge
delta_table.alias("target").merge(
    updates_df.alias("source"),
    "target.user_id = source.user_id"
).whenMatchedUpdate(
    set={
        "email": "source.email",
        "status": "source.status"
    }
).whenNotMatchedInsert(
    values={
        "user_id": "source.user_id",
        "email": "source.email",
        "status": "source.status"
    }
).execute()
```

### 8.3 Delete Records

```python
delta_table.delete("status = 'deleted'")
```

---

## 9. Step 5 – Schema Evolution

### 9.1 Add Columns

```python
# Enable automatic schema evolution
df.write \
    .format("delta") \
    .mode("append") \
    .option("mergeSchema", "true") \
    .save("s3://delta-bucket/tables/users/")
```

### 9.2 Manual Schema Changes

```python
# Add column
spark.sql("""
    ALTER TABLE users
    ADD COLUMN last_login TIMESTAMP
""")

# Change column type (requires rewrite)
spark.sql("""
    ALTER TABLE users
    ALTER COLUMN user_id TYPE BIGINT
""")
```

### 9.3 Schema Validation

```python
# Strict schema enforcement (default)
df.write \
    .format("delta") \
    .mode("append") \
    .option("mergeSchema", "false") \
    .save("s3://delta-bucket/tables/users/")
```

---

## 10. Step 6 – Optimization

### 10.1 Z-Ordering

Optimize for query patterns:

```python
# Z-order by frequently filtered columns
delta_table.optimize() \
    .executeZOrderBy(["user_id", "created_at"])
```

### 10.2 Compaction

Merge small files:

```python
# Compact files
delta_table.optimize().executeCompaction()
```

### 10.3 Partitioning

```python
# Write partitioned table
df.write \
    .format("delta") \
    .partitionBy("year", "month") \
    .save("s3://delta-bucket/tables/events/")
```

### 10.4 Vacuum

Remove old files:

```python
# Remove files older than 7 days
delta_table.vacuum(retentionHours=168)
```

---

## 11. Step 7 – Streaming with Delta

### 11.1 Streaming Writes

```python
# Read streaming source
stream_df = spark.readStream \
    .format("kafka") \
    .option("kafka.bootstrap.servers", "broker:9092") \
    .option("subscribe", "events") \
    .load()

# Write to Delta
stream_df.writeStream \
    .format("delta") \
    .outputMode("append") \
    .option("checkpointLocation", "s3://delta-bucket/checkpoints/events/") \
    .start("s3://delta-bucket/tables/events/")
```

### 11.2 Change Data Capture (CDC)

```python
# Read change feed
changes_df = spark.readStream \
    .format("delta") \
    .option("readChangeFeed", "true") \
    .load("s3://delta-bucket/tables/users/")

# Process changes
changes_df.writeStream \
    .format("console") \
    .start()
```

---

## 12. Best Practices

### 12.1 Table Design

* **Partition wisely** - Don't over-partition (aim for 1-10GB per partition)
* **Use Z-ordering** - For frequently filtered columns
* **Schema evolution** - Plan for future changes
* **Naming conventions** - Consistent table and column names

### 12.2 Performance

* **File sizes** - Target 128MB-1GB per file
* **Compaction** - Regular compaction for small files
* **Caching** - Cache frequently accessed tables
* **Statistics** - Keep table statistics updated

### 12.3 Operations

* **Vacuum regularly** - Remove old files to save storage
* **Monitor file count** - Too many small files hurt performance
* **Version retention** - Configure appropriate retention
* **Backup strategy** - Consider cross-region replication

### 12.4 Security

* **Encryption** - Enable S3 encryption
* **Access control** - Use IAM and S3 bucket policies
* **Audit logging** - Enable CloudTrail for S3
* **Data classification** - Tag sensitive data

---

## 13. Monitoring

### 13.1 Table Metrics

```python
# Get table details
spark.sql("DESCRIBE DETAIL users").show()

# Get file statistics
spark.sql("DESCRIBE HISTORY users").show()
```

### 13.2 CloudWatch Metrics

Monitor S3 and EMR metrics:
* S3 request counts and data transfer
* EMR cluster utilization
* Spark job metrics

### 13.3 Delta Log Analysis

```python
# Analyze transaction log
spark.read.format("json") \
    .load("s3://delta-bucket/tables/users/_delta_log/*.json") \
    .show()
```

---

## 14. References

* [Delta Lake Documentation](https://delta.io/)
* [Delta Lake on AWS](https://docs.delta.io/latest/index.html)
* [Databricks Delta Lake Guide](https://docs.databricks.com/delta/)

