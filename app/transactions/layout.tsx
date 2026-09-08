import type { ReactNode } from "react";
import { TransactionReviewProvider } from "@/components/transactions/TransactionReviewProvider";

export default function TransactionsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <TransactionReviewProvider>{children}</TransactionReviewProvider>;
}
