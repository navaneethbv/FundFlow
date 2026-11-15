import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = (error, _request, context) => {
  // The route template and error class exclude URL parameters, bodies and headers.
  console.error("[request.error]", {
    route: context.routePath,
    type: context.routeType,
    errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
  });
};
