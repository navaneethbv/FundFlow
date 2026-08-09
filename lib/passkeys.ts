export interface PasskeyAvailability {
  available: boolean;
  reason: string | null;
}

interface PasskeyAvailabilityOptions {
  browserSupported?: boolean;
  projectEnabled?: boolean;
}

const PASSKEY_HOSTS = new Set(["localhost", "fund-flow-swart.vercel.app"]);

export function getPasskeyAvailability(
  hostname: string,
  secureContext: boolean,
  options: PasskeyAvailabilityOptions = {},
): PasskeyAvailability {
  if (options.projectEnabled === false) {
    return { available: false, reason: "Passkeys are not enabled for this FundFlow project." };
  }
  if (options.browserSupported === false) {
    return { available: false, reason: "This browser does not support passkeys." };
  }
  if (!PASSKEY_HOSTS.has(hostname)) {
    return {
      available: false,
      reason: "Passkeys are available only on localhost and the canonical FundFlow production site.",
    };
  }
  if (!secureContext && hostname !== "localhost") {
    return { available: false, reason: "Passkeys require a secure HTTPS connection." };
  }
  return { available: true, reason: null };
}

export function passkeyErrorMessage(error: unknown): string {
  const name = typeof error === "object" && error !== null && "name" in error
    ? String(error.name)
    : "";
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
  if (name === "NotAllowedError" || name === "AbortError") {
    return "The passkey request was cancelled or timed out. Please try again.";
  }
  if (name === "NotSupportedError") {
    return "This browser or device does not support this passkey operation.";
  }
  if (code === "passkey_disabled") {
    return "Passkeys are not enabled for this FundFlow project.";
  }
  if (code === "too_many_passkeys") {
    return "This account has reached its passkey limit. Delete one before adding another.";
  }
  return "The passkey could not be verified. Please try again or use another sign-in method.";
}
