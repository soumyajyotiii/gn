# Kubernetes Load Testing CI

Automated CI pipeline for load testing Kubernetes deployments with Prometheus monitoring.

## What Does This Do

When you create a pull request, the CI automatically spins up a kubernetes cluster, deploys some apps, runs load tests, and posts the results back to your PR. Everything runs in GitHub Actions on ephemeral environments.

## How It Works

The workflow does everything from scratch:

1. Provisions a multi-node kind cluster (1 control plane + 2 workers)
2. Deploys nginx ingress controller for routing
3. Deploys two http-echo apps - one returns "foo" and another returns "bar"
4. Sets up ingress routes so foo.localhost goes to foo app and bar.localhost goes to bar app
5. Deploys Prometheus for monitoring
6. Validates everything is healthy
7. Runs k6 load tests with randomized traffic to both hosts
8. Collects CPU and memory metrics from Prometheus
9. Posts everything to the PR as a comment
10. Cleans up the cluster

Everything happens in the CI runner - nothing needs to be setup beforehand.

## Load Testing Details

The k6 script simulates realistic traffic:
- 50 virtual users for 2 minutes
- Randomly picks between foo.localhost and bar.localhost for each request
- Random sleep intervals (0.5-2 seconds) between requests to simulate user behavior
- Validates response status and content
- Tracks error rates and performance metrics

## Ingress Routing

The nginx ingress routes based on host headers:
- `Host: foo.localhost` → foo-service → foo-app pods (returns "foo")
- `Host: bar.localhost` → bar-service → bar-app pods (returns "bar")

Both apps run with 2 replicas and have health checks configured.

## Prometheus Monitoring

Prometheus gets deployed in the ephemeral cluster and collects metrics during the load test. After the test completes, the workflow queries Prometheus for:
- Average CPU usage for foo and bar apps
- Average memory usage for foo and bar apps

These metrics get included in the PR comment alongside the k6 results.

## PR Comment Format

After the workflow runs you get a comment with:

### Test Configuration
- Number of virtual users
- Test duration
- Target hosts

### Results
- Total HTTP requests
- Requests per second
- Error rate percentage
- Average response time
- P90 and P95 response times

### Resource Utilization
- CPU usage for each app (in percentage)
- Memory usage for each app (in MB)

Plus the full k6 output in a collapsible section.

## Implementation Notes

### Health Checks Before Testing
Before running load tests, the workflow validates:
- All pods are running and ready
- Ingress routes are configured
- Both endpoints return the expected responses

This prevents false negatives in the load test results.

### Prometheus Queries
The workflow uses Prometheus HTTP API to query:
- `avg(rate(container_cpu_usage_seconds_total{pod=~"foo-app.*"}[2m]))` for CPU
- `avg(container_memory_usage_bytes{pod=~"foo-app.*"})` for memory

Queries use the last 2 minutes of data which covers the load test window.
