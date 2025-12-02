---
title: Data Warehousing with Amazon Redshift
description: Building scalable data warehouses using Amazon Redshift for analytics and reporting
category: Data Engineering
order: 3
---

## 1. Purpose

This document describes **how to build and operate data warehouses using Amazon Redshift**, enabling:

* **Centralized data storage** for analytics workloads
* **High-performance queries** on large datasets
* **Integration** with BI tools and data pipelines
* **Scalable architecture** that grows with data volume

The typical architecture:

> **Source Systems → ETL Pipelines → S3/Redshift → Data Warehouse → BI Tools & Analytics**

---

## 2. Background & Scope

### 2.1 Amazon Redshift Overview

Amazon Redshift is a **fully managed, petabyte-scale data warehouse** service. It uses columnar storage and parallel query execution for fast analytics.

Key features:

* **Columnar storage** for analytical queries
* **Massively Parallel Processing (MPP)** architecture
* **Integration** with S3, ETL tools, and BI platforms
* **Automatic backups** and point-in-time recovery

### 2.2 Scope of this doc

This document covers:

* Setting up **Redshift clusters**
* **Data modeling** best practices
* **ETL patterns** for loading data
* **Query optimization** techniques
* **Monitoring and maintenance**

Out of scope:

* Redshift Serverless (separate service)
* Advanced ML integration
* Cross-region replication

---

## 3. Architecture Options

### 3.1 Redshift Cluster Types

**RA3 (Recommended):**
* **Managed storage** - Automatically scales
* **Pay for compute** - Separate storage costs
* **Better for** variable workloads

**DC2 (Dense Compute):**
* **Fixed storage** per node
* **Better for** predictable workloads
* **Lower cost** for smaller datasets

### 3.2 Node Configuration

**Single-node (dev/test):**
* `dc2.large` - 160 GB storage, 2 vCPU

**Multi-node (production):**
* **Leader node** - Coordinates queries
* **Compute nodes** - Execute queries in parallel
* Start with 2-4 nodes, scale as needed

---

## 4. Prerequisites

### 4.1 AWS Environment

* AWS account with appropriate permissions
* **VPC** configured for Redshift networking
* **S3 buckets** for data staging
* Understanding of **SQL** and data warehousing concepts

### 4.2 Access Requirements

* Ability to create:
  * **Redshift cluster**
  * **IAM roles** for S3 access
  * **Security groups** for network access
  * **Parameter groups** for cluster configuration

---

## 5. Step 1 – Create Redshift Cluster

### 5.1 Via AWS Console

1. Navigate to **Amazon Redshift** in AWS Console
2. Click **Create cluster**
3. Configure:
   * **Cluster identifier**: `production-warehouse`
   * **Node type**: `ra3.xlplus` (or `dc2.large` for dev)
   * **Number of nodes**: 2 (start small, scale up)
   * **Database name**: `analytics`
   * **Master username**: `admin`
   * **Master password**: (set secure password)
   * **VPC**: Select appropriate VPC
   * **Subnet group**: Create or select existing
   * **Security group**: Allow access from ETL/BI tools

### 5.2 Via CLI

```bash
aws redshift create-cluster \
  --cluster-identifier production-warehouse \
  --node-type ra3.xlplus \
  --number-of-nodes 2 \
  --master-username admin \
  --master-user-password 'SecurePassword123!' \
  --db-name analytics \
  --vpc-security-group-ids sg-xxxxxxxxx \
  --cluster-subnet-group-name redshift-subnet-group
```

### 5.3 Get Cluster Endpoint

```bash
aws redshift describe-clusters \
  --cluster-identifier production-warehouse \
  --query 'Clusters[0].Endpoint.Address'
```

Save the endpoint for connection strings.

---

## 6. Step 2 – Data Modeling

### 6.1 Star Schema Design

**Fact Tables:**
* Store **transactional data** (sales, events)
* Foreign keys to dimension tables
* **Large tables** with many rows

**Dimension Tables:**
* Store **descriptive data** (customers, products, dates)
* **Smaller tables** with fewer rows
* Used for filtering and grouping

### 6.2 Distribution Keys

Choose distribution style based on query patterns:

**KEY distribution:**
```sql
CREATE TABLE sales_fact (
    sale_id BIGINT,
    customer_id INT,
    product_id INT,
    sale_date DATE,
    amount DECIMAL(10,2)
)
DISTKEY(customer_id)  -- Distribute by customer_id
SORTKEY(sale_date);    -- Sort by date for time-based queries
```

**ALL distribution:**
```sql
CREATE TABLE dim_product (
    product_id INT,
    product_name VARCHAR(255),
    category VARCHAR(100)
)
DISTSTYLE ALL;  -- Copy to all nodes (small dimension tables)
```

**EVEN distribution:**
```sql
CREATE TABLE staging_table (
    id BIGINT,
    data JSONB
)
DISTSTYLE EVEN;  -- Round-robin distribution
```

### 6.3 Sort Keys

Optimize queries with sort keys:

```sql
CREATE TABLE events (
    event_id BIGINT,
    user_id INT,
    event_timestamp TIMESTAMP,
    event_type VARCHAR(50)
)
SORTKEY(event_timestamp);  -- Single sort key

-- Or compound sort key
SORTKEY(event_timestamp, user_id);
```

---

## 7. Step 3 – Load Data

### 7.1 COPY Command from S3

**Most efficient** for bulk loads:

```sql
COPY sales_fact
FROM 's3://data-lake-bucket/sales/2024/01/'
IAM_ROLE 'arn:aws:iam::ACCOUNT:role/RedshiftS3Role'
FORMAT JSON
GZIP
DELIMITER ','
IGNOREHEADER 1;
```

### 7.2 Incremental Loads

Use staging table pattern:

```sql
-- Load to staging
COPY staging_sales
FROM 's3://data-lake-bucket/sales/incremental/'
IAM_ROLE 'arn:aws:iam::ACCOUNT:role/RedshiftS3Role'
FORMAT JSON;

-- Merge into fact table
BEGIN TRANSACTION;

DELETE FROM sales_fact
USING staging_sales
WHERE sales_fact.sale_id = staging_sales.sale_id;

INSERT INTO sales_fact
SELECT * FROM staging_sales;

COMMIT;

-- Cleanup
TRUNCATE staging_sales;
```

### 7.3 Using AWS Glue/ETL Tools

For complex transformations:

1. **AWS Glue** - Serverless ETL
2. **dbt** - SQL-based transformations
3. **Airflow** - Orchestration with Redshift operators

---

## 8. Step 4 – Query Optimization

### 8.1 Use Columnar Storage Effectively

**Select only needed columns:**
```sql
-- Good
SELECT customer_id, SUM(amount)
FROM sales_fact
GROUP BY customer_id;

-- Bad (selects all columns)
SELECT *
FROM sales_fact;
```

### 8.2 Leverage Sort Keys

**Queries on sort key columns are faster:**
```sql
-- Fast (uses sort key)
SELECT * FROM events
WHERE event_timestamp >= '2024-01-01'
  AND event_timestamp < '2024-02-01';

-- Slower (full table scan)
SELECT * FROM events
WHERE user_id = 12345;
```

### 8.3 Distribution Key Joins

**Co-locate related data:**
```sql
-- Fast (both tables distributed by customer_id)
SELECT c.customer_name, SUM(s.amount)
FROM dim_customer c
JOIN sales_fact s ON c.customer_id = s.customer_id
GROUP BY c.customer_name;
```

### 8.4 Vacuum and Analyze

**Regular maintenance:**
```sql
-- Reclaim space and resort
VACUUM sales_fact;

-- Update statistics
ANALYZE sales_fact;
```

---

## 9. Step 5 – Monitoring and Maintenance

### 9.1 CloudWatch Metrics

Key metrics to monitor:

* `CPUUtilization` - Cluster CPU usage
* `DatabaseConnections` - Active connections
* `ReadLatency` / `WriteLatency` - Query performance
* `HealthStatus` - Cluster health

### 9.2 Query Performance

**Enable query logging:**
```sql
-- Enable query logging
SET enable_result_cache_for_session TO off;

-- View recent queries
SELECT 
    query,
    starttime,
    endtime,
    duration/1000000 as duration_seconds
FROM stl_query
WHERE userid > 1
ORDER BY starttime DESC
LIMIT 10;
```

### 9.3 WLM (Workload Management)

Configure query queues:

```sql
-- Create WLM configuration
CREATE OR REPLACE WLM_QUEUE (
    query_group = 'etl',
    query_slot_count = 2,
    memory_percent_to_use = 30
);

-- Assign queries to queue
SET query_group TO 'etl';
```

---

## 10. Best Practices

### 10.1 Cluster Sizing

* **Start small** - Begin with 2 nodes, monitor performance
* **Scale up** - Add nodes when CPU/memory constrained
* **Use RA3** - For variable workloads (auto-scaling storage)
* **Monitor** - Track metrics before and after changes

### 10.2 Data Loading

* **Use COPY** - Much faster than INSERT
* **Compress files** - GZIP or BZIP2 for S3 files
* **Parallel loads** - Load multiple files simultaneously
* **Incremental loads** - Only load new/changed data

### 10.3 Query Performance

* **Design for analytics** - Star schema, proper distribution
* **Use sort keys** - For time-series and range queries
* **Avoid SELECT *** - Only select needed columns
* **Monitor query plans** - Use EXPLAIN to understand execution

### 10.4 Security

* **Encryption** - Enable encryption at rest and in transit
* **VPC** - Deploy in private subnets
* **IAM roles** - Use roles instead of access keys
* **Audit logging** - Enable audit logs for compliance

---

## 11. Cost Optimization

### 11.1 Right-Sizing

* **Monitor utilization** - Scale down if consistently < 50% CPU
* **Use reserved instances** - For predictable workloads
* **Pause clusters** - For dev/test environments (not available for RA3)

### 11.2 Storage Optimization

* **Compress data** - Use appropriate compression encodings
* **Archive old data** - Move to S3, query with Redshift Spectrum
* **Clean up** - Regular VACUUM to reclaim space

### 11.3 Query Optimization

* **Cache results** - Enable result caching for repeated queries
* **Optimize WLM** - Prevent long-running queries from blocking others
* **Use materialized views** - For frequently accessed aggregations

---

## 12. References

* [Amazon Redshift User Guide](https://docs.aws.amazon.com/redshift/)
* [Redshift Best Practices](https://docs.aws.amazon.com/redshift/latest/dg/c_best-practices.html)
* [Redshift System Tables](https://docs.aws.amazon.com/redshift/latest/dg/c_intro_system_tables.html)

