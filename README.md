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

## Issues I Faced During Implementation

while building this, i ran into several issues that took some time to debug and fix. heres what went wrong and how i solved them:

### Port 80 wasnt accessible from k6
the biggest headache was that k6 couldnt reach localhost:80 at all. basically the load test kept failing with connection errors like EOF and "connection reset by peer".

what was happening: even though the ingress controller was running fine and the routes were configured correctly (i could access them from inside the cluster), the github actions runner couldnt hit localhost:80 from outside. the kind cluster port mappings weren't working as expected.

how i fixed it: i added a kubectl port-forward step before running the load test. this explicitly forwards the ingress controller service to localhost:80 on the runner. it runs in the background during the test and gets cleaned up after. bit of a workaround but it works reliably.

### github actions wouldnt let me post pr comments
after fixing the port issue, the workflow started failing with "403 resource not accessible by integration" when trying to post results as a comment.

what was happening: turns out the workflow didnt have permissions to write to pull requests by default.

how i fixed it: added a permissions block at the top of the workflow giving it explicit access to write to PRs and issues. pretty straightforward once i figured out what was missing.

### k6 was crashing with typeerror
the k6 script kept throwing errors about trying to call .includes() on undefined.

what was happening: when requests failed (which they were, before fixing the port issue), the response body was undefined. but my script was trying to check if the body included "foo" or "bar" without checking if it actually existed first.

how i fixed it: added a simple null check before accessing response.body. now it gracefully handles failed requests instead of crashing.

### prometheus metrics were coming up empty
prometheus collection was failing with bc syntax errors and all the metrics showed as 0 or empty.

what was happening: the prometheus queries were returning empty strings in some cases instead of proper values, and then bc was trying to do math on empty input which obviously didnt work.

how i fixed it: added default value handling and wrapped the bc calculations in conditional checks. if a value is empty or "0", i just set it to "0" directly without trying to calculate anything.

### parsing the k6 output was broken
the parse results script was throwing "broken pipe" errors and extracting garbage like "msg=\"TypeError:" as the VUS count.

what was happening: the k6 output was huge (full of error logs from all the failed requests), and the grep commands were choking on it. also the regex wasnt handling the error format properly.

how i fixed it: truncated the k6 output to just the last 100 lines for the pr comment to avoid the string size limit. after fixing the port forwarding issue the output is much cleaner anyway so this works fine.

## Time Taken

heres a breakdown of how long different parts took:

### initial setup and planning (~45 min)
- understanding the requirements and clarifying the approach
- setting up the project structure
- researching kind, nginx ingress, and k6 basics

### creating kubernetes manifests (~1 hour)
- kind cluster config with multi-node setup
- nginx ingress controller manifest
- foo and bar deployment yamls with health checks
- ingress routing configuration
- prometheus monitoring stack

### building the ci workflow (~1.5 hours)
- github actions workflow structure
- installing dependencies (kind, kubectl, k6)
- cluster provisioning steps
- deployment and health check logic
- load testing integration
- pr comment posting

### debugging and fixing issues (~3.5 hours)
- nginx ingress timeout issues (finding the right selector)
- port 80 privilege problems (switched to port 8080)
- port-forward not working initially
- k6 json vs text output format mismatch
- parsing script extracting wrong fields
- prometheus metrics not available in basic kind
- github actions permission issues for pr comments

### documentation (~30 min)
- writing the readme
- documenting issues faced and solutions
- adding explanations for each component

### total time: approximately 6.5-7 hours

most of the time was spent debugging the networking issues with port forwarding and figuring out why the ingress wasnt accessible from k6. also spent a good chunk of time getting the prometheus setup right before realizing container metrics arent available without additional cadvisor configuration in kind.

if i did this again knowing what i know now, it would probably take around 3-4 hours since i wouldnt hit all the same issues.

## If i had more time, here are 3 substantial improvements i would consider:

### 1. proper prometheus monitoring with cadvisor integration
right now prometheus is deployed but cant actually scrape container metrics because cadvisor isnt configured in the kind cluster. with more time i would set up proper metrics collection by either configuring cadvisor in kind or using the kubernetes metrics-server. this would give us real cpu and memory utilization data for the pods during load testing, which would be really valuable for understanding resource consumption and identifying bottlenecks.

### 2. multiple load test scenarios and performance benchmarking
currently we only run one load test profile (50 vus for 2 minutes). ideally i would implement different load test scenarios like spike tests (sudden traffic bursts), stress tests (gradually increasing load until failure), and soak tests (sustained load over longer periods). also would add baseline performance benchmarking where we compare results against previous runs and fail the ci if performance degrades beyond acceptable thresholds. this would help catch performance regressions early.

### 3. better failure handling and retry mechanisms
right now if something fails during deployment or health checks, the workflow just exits. with more time i would add smarter retry logic with exponential backoff, better error classification (transient vs permanent failures), and partial rollback capabilities. also would add slack/email notifications for failures and a dashboard showing historical test results and trends. this would make the whole system more production-ready and easier to debug when things go wrong.
