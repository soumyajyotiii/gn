import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// we are creating a custom metric here to track the error rate seperately from the default metrics
const errorRate = new Rate('errors');

// we are basically configuring k6 to run with 50 virtual users for 2 minutes
export const options = {
  vus: 50,
  duration: '2m',
  thresholds: {
    http_req_duration: ['p(95)<500'], // i want 95% of requests to complete under 500ms
    errors: ['rate<0.1'], // also the error rate should be below 10%
  },
};

// these are the two hosts i need to test against as per the problem statement
const hosts = ['foo.localhost', 'bar.localhost'];

export default function () {
  // im randomly picking one of the hosts to send traffic to
  const randomHost = hosts[Math.floor(Math.random() * hosts.length)];

  // setiing the host header so the ingress controller knows where to route the request
  const params = {
    headers: {
      'Host': randomHost,
    },
  };

  // sending a get request to localhost with the appropriate host header
  const response = http.get('http://localhost/', params);

  // here we are checking if the response is what i expected it to be
  const success = check(response, {
    'status is 200': (r) => r.status === 200,
    'response contains expected text': (r) => {
      // checking if body exists first to avoid errors
      if (!r.body) return false;

      // if i called foo.localhost the response should contain "foo"
      // if i called bar.localhost it should contain "bar"
      if (randomHost === 'foo.localhost') {
        return r.body.includes('foo');
      } else {
        return r.body.includes('bar');
      }
    },
  });

  // tracking the error rate here, so we can see it in the final report
  errorRate.add(!success);

  // here im adding a random sleep between 0.5 and 2 seconds to give a sense of actual user behavoir where there are pauses between requests
  sleep(Math.random() * 1.5 + 0.5);
}

// this function formats the output as json so its easier to parse in the ci pipeline
export function handleSummary(data) {
  const summary = {
    'stdout': JSON.stringify(data, null, 2),
  };

  return summary;
}
