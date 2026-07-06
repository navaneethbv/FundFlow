import { Suspense } from "react";
import LoginForm from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      {/* LoginForm reads useSearchParams (callback errors), which requires a
          Suspense boundary on this prerendered page. */}
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
