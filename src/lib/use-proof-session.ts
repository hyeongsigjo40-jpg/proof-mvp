"use client";

import { useCallback, useEffect, useState } from "react";
import { getCurrentUserId, getProfile } from "@/lib/proof-store";
import type { Profile } from "@/types/proof";

export function useProofSession() {
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const currentUserId = await getCurrentUserId();
      setUserId(currentUserId);

      if (currentUserId) {
        setProfile(await getProfile(currentUserId));
      } else {
        setProfile(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "알 수 없는 문제가 생겼어요.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { loading, userId, profile, error, refresh };
}
