/**
 * Service Health Checks
 *
 * Provides utilities to check health of downstream services
 * (research engine, EDR, citation verifier) before dispatching work.
 */

const RESEARCH_ENGINE_URL = process.env.RESEARCH_ENGINE_URL || 'http://localhost:4456';
const EDR_URL = process.env.EDR_URL || 'http://localhost:9001';
const VERIFIER_URL = process.env.VERIFIER_URL || 'http://localhost:9002';

interface HealthCheckResult {
  healthy: boolean;
  service: string;
  error?: string;
}

/**
 * Check if a service is healthy.
 * @param url - Service health endpoint URL
 * @param serviceName - Name of the service (for logging)
 * @param timeoutMs - Request timeout in milliseconds (default 5000)
 * @returns Health check result
 */
export async function checkServiceHealth(
  url: string,
  serviceName: string,
  timeoutMs = 5000,
): Promise<HealthCheckResult> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.ok) {
      return { healthy: true, service: serviceName };
    }

    return {
      healthy: false,
      service: serviceName,
      error: `HTTP ${response.status}`,
    };
  } catch (err: unknown) {
    const error = err as Error;
    return {
      healthy: false,
      service: serviceName,
      error: error.message,
    };
  }
}

/**
 * Wait for a service to become healthy.
 * Retries with exponential backoff.
 * @param url - Service health endpoint URL
 * @param serviceName - Name of the service
 * @param maxRetries - Maximum number of retries (default 3)
 * @param timeoutMs - Request timeout per attempt in milliseconds (default 5000)
 * @returns True if service became healthy, false otherwise
 */
export async function waitForService(
  url: string,
  serviceName: string,
  maxRetries = 3,
  timeoutMs = 5000,
): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await checkServiceHealth(url, serviceName, timeoutMs);
    if (result.healthy) {
      if (attempt > 0) {
        console.log(`[health] ${serviceName} became healthy after ${attempt + 1} attempts`);
      }
      return true;
    }

    if (attempt < maxRetries - 1) {
      const backoffMs = Math.min(1000 * Math.pow(2, attempt), 5000);
      console.log(
        `[health] ${serviceName} not ready (${result.error}), retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})`,
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  console.error(`[health] ${serviceName} failed health check after ${maxRetries} attempts`);
  return false;
}

/**
 * Check health of research engine.
 */
export async function checkResearchEngineHealth(): Promise<boolean> {
  return waitForService(`${RESEARCH_ENGINE_URL}/api/health`, 'research-engine');
}

/**
 * Check health of EDR service.
 */
export async function checkEDRHealth(): Promise<boolean> {
  return waitForService(`${EDR_URL}/health`, 'edr');
}

/**
 * Check health of citation verifier service.
 */
export async function checkVerifierHealth(): Promise<boolean> {
  return waitForService(`${VERIFIER_URL}/health`, 'citation-verifier');
}
