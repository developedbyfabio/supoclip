"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, CheckCircle } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { SocialProviderIcon } from "@/components/social-provider-icon";
import { connectionLabel, type SocialConnection } from "@/lib/social";

interface AutoPublishRule {
  enabled: boolean;
  social_account_ids: string[];
  clips_per_task: number;
  min_virality_score: number;
  post_times: string[];
  timezone: string;
  privacy_level: "public" | "unlisted" | "private";
  hashtags: string[];
  updated_at: string | null;
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
  } catch {
    return "America/Sao_Paulo";
  }
}

export function AutoPublishSettings({
  connections,
  sectionHeadingClassName,
}: {
  connections: SocialConnection[];
  sectionHeadingClassName: string;
}) {
  const t = useTranslations("social.autoPublish");
  const tPrivacy = useTranslations("social.privacy");
  const [rule, setRule] = useState<AutoPublishRule | null>(null);
  const [timesText, setTimesText] = useState("");
  const [hashtagsText, setHashtagsText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/social/auto-publish", { cache: "no-store" });
        if (!response.ok) throw new Error(t("loadError"));
        const data = (await response.json()) as { rule: AutoPublishRule };
        if (cancelled) return;
        // A rule that was never saved adopts the viewer's timezone.
        const loaded = data.rule.updated_at ? data.rule : { ...data.rule, timezone: browserTimezone() };
        setRule(loaded);
        setTimesText(loaded.post_times.join(", "));
        setHashtagsText(loaded.hashtags.map((tag) => `#${tag}`).join(" "));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t("loadError"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const activeConnections = connections.filter((connection) => connection.status === "active");

  const update = (patch: Partial<AutoPublishRule>) => {
    setSaved(false);
    setRule((current) => (current ? { ...current, ...patch } : current));
  };

  const toggleAccount = (accountId: string, checked: boolean) => {
    if (!rule) return;
    const ids = checked
      ? [...rule.social_account_ids, accountId]
      : rule.social_account_ids.filter((id) => id !== accountId);
    update({ social_account_ids: ids });
  };

  const handleSave = async () => {
    if (!rule) return;
    setIsSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/social/auto-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...rule,
          post_times: timesText.split(/[\s,;]+/).filter(Boolean),
          hashtags: hashtagsText.split(/[\s,]+/).filter(Boolean),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.detail || t("saveError"));
      }
      const savedRule = (data as { rule: AutoPublishRule }).rule;
      setRule(savedRule);
      setTimesText(savedRule.post_times.join(", "));
      setHashtagsText(savedRule.hashtags.map((tag) => `#${tag}`).join(" "));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveError"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="mb-10">
      <h2 className={sectionHeadingClassName}>{t("heading")}</h2>
      {!rule ? (
        error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <Skeleton className="h-40 w-full" />
        )
      ) : (
        <div className="space-y-5 rounded-xl border bg-background p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="auto-publish-enabled" className="text-sm font-medium">
                {t("enabled")}
              </Label>
              <p className="mt-1 text-xs text-muted-foreground">{t("enabledHint")}</p>
            </div>
            <Switch
              id="auto-publish-enabled"
              checked={rule.enabled}
              onCheckedChange={(checked) => update({ enabled: checked })}
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">{t("accounts")}</p>
            {activeConnections.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("noAccounts")}</p>
            ) : (
              activeConnections.map((connection) => (
                <label key={connection.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={rule.social_account_ids.includes(connection.id)}
                    onCheckedChange={(checked) => toggleAccount(connection.id, checked === true)}
                  />
                  <SocialProviderIcon provider={connection.provider} className="size-4" />
                  {connectionLabel(connection)}
                </label>
              ))
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="auto-publish-clips">{t("clipsPerTask")}</Label>
              <Input
                id="auto-publish-clips"
                type="number"
                min={1}
                max={10}
                value={rule.clips_per_task}
                onChange={(event) => update({ clips_per_task: Number(event.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auto-publish-score">{t("minScore")}</Label>
              <Input
                id="auto-publish-score"
                type="number"
                min={0}
                max={100}
                value={rule.min_virality_score}
                onChange={(event) => update({ min_virality_score: Number(event.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auto-publish-times">{t("postTimes")}</Label>
              <Input
                id="auto-publish-times"
                placeholder="12:00, 18:00"
                value={timesText}
                onChange={(event) => {
                  setSaved(false);
                  setTimesText(event.target.value);
                }}
              />
              <p className="text-xs text-muted-foreground">{t("postTimesHint", { timezone: rule.timezone })}</p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("privacy")}</Label>
              <Select
                value={rule.privacy_level}
                onValueChange={(value) => update({ privacy_level: value as AutoPublishRule["privacy_level"] })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">{tPrivacy("public")}</SelectItem>
                  <SelectItem value="unlisted">{tPrivacy("unlisted")}</SelectItem>
                  <SelectItem value="private">{tPrivacy("private")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="auto-publish-hashtags">{t("hashtags")}</Label>
            <Input
              id="auto-publish-hashtags"
              placeholder="#shorts"
              value={hashtagsText}
              onChange={(event) => {
                setSaved(false);
                setHashtagsText(event.target.value);
              }}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {saved && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>{rule.enabled ? t("savedOn") : t("savedOff")}</AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? t("saving") : t("save")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
