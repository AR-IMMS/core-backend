import * as restate from '@restatedev/restate-sdk';

import { demoWorkflow } from './demo.workflow';

restate.serve({
  services: [demoWorkflow],
  port: 9080,
});
