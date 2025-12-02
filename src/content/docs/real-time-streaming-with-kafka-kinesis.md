---
title: Real-Time Streaming with Kafka and Kinesis
description: Building real-time data streaming pipelines using Apache Kafka and Amazon Kinesis
category: Data Engineering
order: 2
---

## 1. Purpose

This document describes **how to build real-time data streaming pipelines** using **Apache Kafka** and **Amazon Kinesis**, enabling:

* **Real-time data ingestion** from multiple sources
* **Stream processing** with low latency
* **Scalable** event-driven architectures
* **Integration** with downstream analytics and storage systems

The typical flow:

> **Data Sources → Kafka/Kinesis → Stream Processors → Data Lakes/Warehouses → Real-Time Dashboards**

---

## 2. Background & Scope

### 2.1 Streaming Platforms Overview

**Apache Kafka:**
* Open-source distributed event streaming platform
* High throughput and low latency
* Self-managed or via MSK (Managed Streaming for Apache Kafka)

**Amazon Kinesis:**
* Fully managed streaming service
* Multiple services: Kinesis Data Streams, Firehose, Analytics
* Native AWS integration

### 2.2 Scope of this doc

This document covers:

* Setting up **Kafka clusters** (MSK or self-managed)
* Configuring **Kinesis Data Streams**
* **Stream processing** with Kafka Streams and Kinesis Analytics
* **Best practices** for production deployments

Out of scope:

* Detailed Kafka internals and replication
* Advanced stream processing frameworks (Flink, Spark Streaming)
* Multi-region disaster recovery

---

## 3. Architecture Options

### 3.1 Amazon MSK (Managed Streaming for Kafka)

**Recommended for Kafka workloads:**

* **Fully managed** - No cluster management
* **Automatic patching** and updates
* **Multi-AZ** deployment for high availability
* **Compatible** with Apache Kafka APIs

### 3.2 Amazon Kinesis Data Streams

**For AWS-native streaming:**

* **Serverless** - No infrastructure to manage
* **Automatic scaling** based on throughput
* **Integrated** with other AWS services
* **Pay-per-use** pricing model

---

## 4. Prerequisites

### 4.1 AWS Environment

* AWS account with appropriate permissions
* **VPC** configured for networking
* **IAM roles** for service access
* Understanding of **streaming concepts** (producers, consumers, partitions)

### 4.2 Access Requirements

* Ability to create:
  * **MSK cluster** (or Kinesis streams)
  * **EC2 instances** for Kafka clients (if self-managed)
  * **IAM roles** for service access
  * **CloudWatch** for monitoring

---

## 5. Step 1 – Set Up Amazon MSK Cluster

### 5.1 Create MSK Cluster

Via AWS Console:

1. Navigate to **Amazon MSK** in AWS Console
2. Click **Create cluster**
3. Configure:
   * **Cluster name**: `production-kafka-cluster`
   * **Kafka version**: Latest stable (e.g., 3.5.1)
   * **Broker instance type**: `kafka.m5.large` (start with 2 brokers)
   * **Storage**: EBS volumes (100 GB per broker)
   * **Networking**: VPC, subnets (at least 2 AZs)
   * **Security**: VPC security groups, encryption

### 5.2 Configure Client Authentication

For production, enable **SASL/SCRAM**:

```bash
# Create MSK configuration
aws kafka create-configuration \
  --name kafka-config \
  --kafka-versions "3.5.1" \
  --server-properties file://server.properties
```

Example `server.properties`:

```properties
auto.create.topics.enable=true
default.replication.factor=3
min.insync.replicas=2
```

### 5.3 Get Bootstrap Brokers

```bash
aws kafka get-bootstrap-brokers \
  --cluster-arn arn:aws:kafka:us-east-1:ACCOUNT:cluster/CLUSTER-NAME/xxxxx
```

Save the bootstrap broker endpoints for client configuration.

---

## 6. Step 2 – Set Up Kinesis Data Streams

### 6.1 Create Kinesis Stream

Via AWS Console:

1. Navigate to **Amazon Kinesis** → **Data Streams**
2. Click **Create data stream**
3. Configure:
   * **Stream name**: `user-events-stream`
   * **Capacity mode**: On-demand (or Provisioned with shards)
   * **Encryption**: KMS or default

### 6.2 CLI Creation

```bash
aws kinesis create-stream \
  --stream-name user-events-stream \
  --stream-mode-details StreamModeDetails={StreamMode=ON_DEMAND}
```

### 6.3 Stream Configuration

For **provisioned mode** (more control):

```bash
aws kinesis create-stream \
  --stream-name user-events-stream \
  --shard-count 4
```

Each shard supports:
* **1 MB/second** write throughput
* **2 MB/second** read throughput
* **1000 records/second**

---

## 7. Step 3 – Produce Data to Streams

### 7.1 Kafka Producer (Python)

```python
from kafka import KafkaProducer
import json

# Configure producer
producer = KafkaProducer(
    bootstrap_servers=['bootstrap-broker-1:9092', 'bootstrap-broker-2:9092'],
    value_serializer=lambda v: json.dumps(v).encode('utf-8'),
    security_protocol='SASL_SSL',
    sasl_mechanism='SCRAM-SHA-512',
    sasl_plain_username='kafka-user',
    sasl_plain_password='kafka-password',
)

# Send message
producer.send(
    'user-events',
    value={'user_id': '12345', 'event': 'page_view', 'timestamp': '2024-01-15T10:30:00Z'}
)
producer.flush()
```

### 7.2 Kinesis Producer (Python)

```python
import boto3
import json

kinesis = boto3.client('kinesis', region_name='us-east-1')

# Put record
response = kinesis.put_record(
    StreamName='user-events-stream',
    Data=json.dumps({
        'user_id': '12345',
        'event': 'page_view',
        'timestamp': '2024-01-15T10:30:00Z'
    }),
    PartitionKey='12345'  # Partition by user_id
)
```

### 7.3 Batch Production

For **Kinesis**, use `put_records` for batch:

```python
records = [
    {
        'Data': json.dumps(event),
        'PartitionKey': event['user_id']
    }
    for event in events
]

kinesis.put_records(
    StreamName='user-events-stream',
    Records=records
)
```

---

## 8. Step 4 – Consume and Process Streams

### 8.1 Kafka Consumer (Python)

```python
from kafka import KafkaConsumer
import json

consumer = KafkaConsumer(
    'user-events',
    bootstrap_servers=['bootstrap-broker-1:9092'],
    value_deserializer=lambda m: json.loads(m.decode('utf-8')),
    group_id='analytics-group',
    auto_offset_reset='earliest',
    enable_auto_commit=True,
)

for message in consumer:
    event = message.value
    # Process event
    process_event(event)
```

### 8.2 Kinesis Consumer (Python)

```python
import boto3
import json

kinesis = boto3.client('kinesis', region_name='us-east-1')

# Get shard iterator
response = kinesis.get_shard_iterator(
    StreamName='user-events-stream',
    ShardId='shardId-000000000000',
    ShardIteratorType='LATEST'
)

shard_iterator = response['ShardIterator']

# Read records
while True:
    response = kinesis.get_records(
        ShardIterator=shard_iterator,
        Limit=100
    )
    
    for record in response['Records']:
        event = json.loads(record['Data'])
        process_event(event)
    
    shard_iterator = response['NextShardIterator']
```

### 8.3 Kinesis Data Firehose (Managed Consumer)

For automatic delivery to S3, Redshift, etc.:

```bash
aws firehose create-delivery-stream \
  --delivery-stream-name user-events-firehose \
  --kinesis-stream-source-configuration '{
    "KinesisStreamARN": "arn:aws:kinesis:us-east-1:ACCOUNT:stream/user-events-stream",
    "RoleARN": "arn:aws:iam::ACCOUNT:role/firehose-delivery-role"
  }' \
  --s3-destination-configuration '{
    "RoleARN": "arn:aws:iam::ACCOUNT:role/firehose-delivery-role",
    "BucketARN": "arn:aws:s3:::data-lake-bucket",
    "Prefix": "user-events/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/"
  }'
```

---

## 9. Step 5 – Stream Processing

### 9.1 Kafka Streams (Java)

```java
StreamsBuilder builder = new StreamsBuilder();

KStream<String, String> source = builder.stream("user-events");

source
    .filter((key, value) -> value.contains("purchase"))
    .mapValues(value -> transformEvent(value))
    .to("processed-events");

KafkaStreams streams = new KafkaStreams(builder.build(), props);
streams.start();
```

### 9.2 Kinesis Data Analytics (SQL)

Create application with SQL:

```sql
CREATE STREAM user_events_stream (
    user_id VARCHAR(64),
    event_type VARCHAR(32),
    timestamp TIMESTAMP
) WITH (
    KINESIS_SOURCE_STREAM = 'user-events-stream',
    STARTING_POSITION = 'LATEST'
);

CREATE STREAM processed_events AS
SELECT 
    user_id,
    event_type,
    timestamp,
    COUNT(*) OVER (
        PARTITION BY user_id 
        RANGE INTERVAL '1' HOUR PRECEDING
    ) as events_last_hour
FROM user_events_stream
WHERE event_type = 'purchase';
```

---

## 10. Monitoring and Alerting

### 10.1 Kafka Metrics (MSK)

MSK exposes CloudWatch metrics:

* `BytesInPerSec` - Incoming data rate
* `BytesOutPerSec` - Outgoing data rate
* `MessagesInPerSec` - Message throughput
* `UnderReplicatedPartitions` - Replication lag

### 10.2 Kinesis Metrics

CloudWatch metrics for Kinesis:

* `IncomingRecords` - Records written to stream
* `IncomingBytes` - Data volume
* `GetRecords.IteratorAgeMilliseconds` - Consumer lag
* `ReadProvisionedThroughputExceeded` - Throttling

### 10.3 Set Up Alarms

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name kafka-high-lag \
  --alarm-description "Alert on Kafka consumer lag" \
  --metric-name ConsumerLag \
  --namespace AWS/Kafka \
  --statistic Average \
  --period 300 \
  --threshold 10000 \
  --comparison-operator GreaterThanThreshold
```

---

## 11. Best Practices

### 11.1 Partitioning Strategy

**Kafka:**
* Partition by **business key** (user_id, order_id)
* Aim for **even distribution** across partitions
* Consider **future growth** when setting partition count

**Kinesis:**
* Use **partition keys** for even distribution
* Avoid **hot partitions** (too many records with same key)
* Monitor **shard-level metrics**

### 11.2 Error Handling

* **Dead Letter Queues (DLQ)** for failed records
* **Retry logic** with exponential backoff
* **Monitoring** for processing failures
* **Alerting** on error rates

### 11.3 Performance Optimization

* **Batch processing** when possible
* **Compression** (snappy, gzip) for Kafka
* **Async producers** for higher throughput
* **Connection pooling** for consumers

---

## 12. References

* [Apache Kafka Documentation](https://kafka.apache.org/documentation/)
* [Amazon MSK User Guide](https://docs.aws.amazon.com/msk/)
* [Amazon Kinesis Documentation](https://docs.aws.amazon.com/kinesis/)

