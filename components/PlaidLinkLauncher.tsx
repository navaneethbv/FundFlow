"use client";

import { useEffect, useRef } from "react";
import { usePlaidLink } from "react-plaid-link";

interface Props {
  token: string | null;
  receivedRedirectUri?: string;
  onSuccess: (publicToken: string | null) => void | Promise<void>;
  onExit: () => void;
}

/**
 * Mount Plaid's SDK only while a user-started Link flow has a token.
 * Keeping the hook out of idle buttons prevents duplicate script injection
 * when a page renders several connect or repair controls.
 */
export default function PlaidLinkLauncher(props: Readonly<Props>) {
  if (!props.token) return null;
  return <ActivePlaidLinkLauncher {...props} token={props.token} />;
}

function ActivePlaidLinkLauncher({
  token,
  receivedRedirectUri,
  onSuccess,
  onExit,
}: Readonly<Props & { token: string }>) {
  const openedRef = useRef(false);
  const { open, ready } = usePlaidLink({
    token,
    receivedRedirectUri,
    onSuccess: (publicToken) => {
      void onSuccess(publicToken);
    },
    onExit,
  });

  useEffect(() => {
    if (!ready || openedRef.current) return;
    openedRef.current = true;
    open();
  }, [open, ready]);

  return null;
}
