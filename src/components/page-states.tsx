import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function PagePending() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}

export function PageError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border bg-card p-8 text-center shadow-card">
      <AlertCircle className="mx-auto size-8 text-danger" />
      <h2 className="mt-3 text-lg font-semibold">Something went wrong</h2>
      <p className="mt-1 text-sm text-muted-foreground">{(error instanceof Error && error.message) || "This page could not be loaded."}</p>
      <Button
        className="mt-5"
        onClick={() => {
          router.invalidate();
          reset();
        }}
      >
        Try again
      </Button>
    </div>
  );
}
