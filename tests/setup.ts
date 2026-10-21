import { setLogLevel } from '../src/shared/logger';

/**
 * Test setup.
 *
 * Tests deliberately exercise failure paths (rejections, conflicts, rate
 * limits). Their log lines are still buffered and asserted directly, but they
 * would drown the report, so console output is muted.
 */
setLogLevel('silent');
