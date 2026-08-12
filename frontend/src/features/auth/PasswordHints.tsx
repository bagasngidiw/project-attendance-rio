/**
 * PasswordHints — live policy validation hints for any password input
 * (FR-044 §6.3). Fetches the public policy shape once and evaluates it
 * against the provided value.
 */

import { useQuery } from "@tanstack/react-query";

import { passwordPolicyApi } from "@/lib/axios";
import { validatePasswordAgainstPolicy } from "./passwordPolicy";

export function PasswordHints({ password }: { password: string }) {
  const { data: policy } = useQuery({
    queryKey: ["password-policy"],
    queryFn: () => passwordPolicyApi.get().then((r) => r.data.data),
    retry: 1,
  });

  if (!policy) return null;

  const hints = validatePasswordAgainstPolicy(policy, password);
  if (hints.length === 0) return null;

  return (
    <ul className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
      {hints.map((hint) => (
        <li key={hint}>• {hint}</li>
      ))}
    </ul>
  );
}
