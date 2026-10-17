import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Save, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import * as api from "@/lib/api";
import type { Rule, RuleDetector } from "@/lib/types";

const emptyNewRule = {
  number: "",
  title: "",
  description: "",
  detector: "",
  action: "warn" as "warn" | "ban",
  banDays: "",
};

interface RuleDraft {
  number: string;
  title: string;
  description: string;
  detector: string;
  action: "warn" | "ban";
  banDays: string;
  enabled: boolean;
  deleteContent: boolean;
}

const draftFromRule = (rule: Rule): RuleDraft => ({
  number: String(rule.number),
  title: rule.title,
  description: rule.description,
  detector: rule.detector ?? "",
  action: rule.action === "ban" ? "ban" : "warn",
  banDays: rule.banDays ? String(rule.banDays) : "",
  enabled: rule.enabled,
  deleteContent: rule.deleteContent,
});

/**
 * Вкладка «Правила»: публичная страница #/rules и автоматоры нарушений.
 * Каждый пункт может иметь детектор, который сам выдаёт варн (или бан),
 * когда находит нарушение в контенте.
 */
export function RulesTab() {
  const { t } = useTranslation();
  const [rules, setRules] = useState<Rule[]>([]);
  const [detectors, setDetectors] = useState<RuleDetector[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RuleDraft>>({});
  const [newRule, setNewRule] = useState(emptyNewRule);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [list, library] = await Promise.all([api.getRules(), api.getRuleDetectors()]);
      setRules(list);
      setDetectors(library.detectors);
      setDrafts(Object.fromEntries(list.map((rule) => [rule.id, draftFromRule(rule)])));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const patchDraft = (id: string, patch: Partial<RuleDraft>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const save = async (rule: Rule) => {
    const draft = drafts[rule.id];
    if (!draft) return;
    try {
      const updated = await api.updateRule(rule.id, {
        number: Number(draft.number),
        title: draft.title,
        description: draft.description,
        detector: draft.detector || null,
        action: draft.action,
        banDays: draft.action === "ban" ? Number(draft.banDays) || null : null,
        enabled: draft.enabled,
        deleteContent: draft.deleteContent,
      });
      toast.success(t("admin.ruleSaved", { number: updated.number }));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const remove = async (rule: Rule) => {
    try {
      await api.deleteRule(rule.id);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const create = async () => {
    try {
      await api.createRule({
        number: Number(newRule.number),
        title: newRule.title,
        description: newRule.description,
        detector: newRule.detector || null,
        action: newRule.action,
        banDays: newRule.action === "ban" ? Number(newRule.banDays) || null : null,
      });
      setNewRule(emptyNewRule);
      toast.success(t("admin.ruleAdded"));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const contextsLabel = (rule: Rule) => {
    const contexts = rule.detectorConfig?.contexts;
    if (!Array.isArray(contexts) || contexts.length === 0) return null;
    return contexts.join(", ");
  };

  const detectorLabel = (key: string) => detectors.find((d) => d.key === key)?.label ?? key;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
          <Zap className="h-4 w-4" />
          {t("admin.rulesList")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("admin.rulesHint")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("admin.ruleAutomatorHint")}</p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => {
            const draft = drafts[rule.id] ?? draftFromRule(rule);
            return (
              <div key={rule.id} className="space-y-2 rounded-2xl border border-border bg-card p-3 shadow-soft">
                <div className="grid grid-cols-[80px_1fr] gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`rule-number-${rule.id}`}>{t("admin.ruleNumber")}</Label>
                    <Input
                      id={`rule-number-${rule.id}`}
                      type="number"
                      min={1}
                      value={draft.number}
                      onChange={(e) => patchDraft(rule.id, { number: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`rule-title-${rule.id}`}>{t("admin.ruleTitle")}</Label>
                    <Input
                      id={`rule-title-${rule.id}`}
                      value={draft.title}
                      onChange={(e) => patchDraft(rule.id, { title: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`rule-desc-${rule.id}`}>{t("admin.ruleDescription")}</Label>
                  <Textarea
                    id={`rule-desc-${rule.id}`}
                    rows={2}
                    className="resize-none"
                    value={draft.description}
                    onChange={(e) => patchDraft(rule.id, { description: e.target.value })}
                  />
                </div>

                {/* Автоматор правила */}
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label>{t("admin.ruleAutomator")}</Label>
                    <Select
                      value={draft.detector || "none"}
                      onValueChange={(v) => patchDraft(rule.id, { detector: v === "none" ? "" : v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("admin.ruleAutomatorManual")}</SelectItem>
                        {detectors.map((detector) => (
                          <SelectItem key={detector.key} value={detector.key}>
                            {detector.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>{t("admin.ruleAction")}</Label>
                    <Select
                      value={draft.action}
                      onValueChange={(v) => patchDraft(rule.id, { action: v as "warn" | "ban" })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="warn">{t("admin.ruleActionWarn")}</SelectItem>
                        <SelectItem value="ban">{t("admin.ruleActionBan")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`rule-days-${rule.id}`}>{t("admin.ruleBanDays")}</Label>
                    <Input
                      id={`rule-days-${rule.id}`}
                      type="number"
                      min={1}
                      max={365}
                      disabled={draft.action !== "ban"}
                      value={draft.banDays}
                      onChange={(e) => patchDraft(rule.id, { banDays: e.target.value })}
                      placeholder="∞"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-foreground"
                        checked={draft.enabled}
                        onChange={(e) => patchDraft(rule.id, { enabled: e.target.checked })}
                      />
                      {t("admin.ruleEnabled")}
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-foreground"
                        checked={draft.deleteContent}
                        onChange={(e) => patchDraft(rule.id, { deleteContent: e.target.checked })}
                      />
                      {t("admin.ruleDeleteContent")}
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    {contextsLabel(rule) && (
                      <span className="text-[10px] text-muted-foreground">
                        {t("admin.ruleContexts")}: {contextsLabel(rule)}
                      </span>
                    )}
                    <Button size="sm" variant="outline" onClick={() => save(rule)}>
                      <Save className="h-4 w-4" />
                      {t("common.save")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => remove(rule)}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("common.delete")}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-2 rounded-2xl border border-dashed border-border p-3">
        <h2 className="text-sm font-semibold">{t("admin.addRule")}</h2>
        <div className="grid grid-cols-[80px_1fr] gap-2">
          <div className="space-y-1">
            <Label htmlFor="new-rule-number">{t("admin.ruleNumber")}</Label>
            <Input
              id="new-rule-number"
              type="number"
              min={1}
              value={newRule.number}
              onChange={(e) => setNewRule((prev) => ({ ...prev, number: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-rule-title">{t("admin.ruleTitle")}</Label>
            <Input
              id="new-rule-title"
              value={newRule.title}
              onChange={(e) => setNewRule((prev) => ({ ...prev, title: e.target.value }))}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-rule-description">{t("admin.ruleDescription")}</Label>
          <Textarea
            id="new-rule-description"
            rows={2}
            className="resize-none"
            value={newRule.description}
            onChange={(e) => setNewRule((prev) => ({ ...prev, description: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label>{t("admin.ruleAutomator")}</Label>
            <Select
              value={newRule.detector || "none"}
              onValueChange={(v) => setNewRule((prev) => ({ ...prev, detector: v === "none" ? "" : v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("admin.ruleAutomatorManual")}</SelectItem>
                {detectors.map((detector) => (
                  <SelectItem key={detector.key} value={detector.key}>
                    {detector.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t("admin.ruleAction")}</Label>
            <Select
              value={newRule.action}
              onValueChange={(v) => setNewRule((prev) => ({ ...prev, action: v as "warn" | "ban" }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="warn">{t("admin.ruleActionWarn")}</SelectItem>
                <SelectItem value="ban">{t("admin.ruleActionBan")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {newRule.action === "ban" && (
          <div className="space-y-1">
            <Label htmlFor="new-rule-days">{t("admin.ruleBanDays")}</Label>
            <Input
              id="new-rule-days"
              type="number"
              min={1}
              max={365}
              value={newRule.banDays}
              onChange={(e) => setNewRule((prev) => ({ ...prev, banDays: e.target.value }))}
              placeholder="∞"
            />
          </div>
        )}
        {newRule.detector && (
          <p className="text-[11px] text-muted-foreground">
            {t("admin.ruleDetectorSelected")}: {detectorLabel(newRule.detector)}
          </p>
        )}
        <Button
          size="sm"
          onClick={create}
          disabled={!newRule.number || !newRule.title.trim() || !newRule.description.trim()}
        >
          <Plus className="h-4 w-4" />
          {t("admin.addRuleButton")}
        </Button>
      </div>
    </div>
  );
}
