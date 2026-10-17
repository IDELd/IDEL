import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, ShieldBan, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import * as api from "@/lib/api";
import type { ForbiddenWord } from "@/lib/types";

const CATEGORIES = ["country", "official", "other"];

/**
 * Вкладка «Запрещённые слова»: управление списком, по которому фильтруются ники.
 * Проверка идёт по нормализованной форме (только буквы, нижний регистр),
 * поэтому «o.f.f.i.c.i.a.l» ловится словом «official».
 */
export function ForbiddenWordsTab() {
  const { t } = useTranslation();
  const [words, setWords] = useState<ForbiddenWord[]>([]);
  const [word, setWord] = useState("");
  const [category, setCategory] = useState("other");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setWords(await api.getForbiddenWords());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    try {
      await api.addForbiddenWord(word, category);
      setWord("");
      toast.success(t("admin.forbiddenWordAdded"));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const remove = async (item: ForbiddenWord) => {
    try {
      await api.deleteForbiddenWord(item.id);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <ShieldBan className="h-4 w-4" />
          {t("admin.forbiddenWords")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("admin.forbiddenWordsHint")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-dashed border-border p-3">
        <div className="min-w-[200px] flex-1 space-y-1">
          <Label htmlFor="forbidden-word">{t("admin.forbiddenWord")}</Label>
          <Input
            id="forbidden-word"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder="official"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="forbidden-category">{t("admin.forbiddenCategory")}</Label>
          <select
            id="forbidden-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <Button size="sm" onClick={add} disabled={!word.trim()}>
          <Plus className="h-4 w-4" />
          {t("admin.forbiddenWordAdd")}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : words.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.forbiddenWordsEmpty")}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {words.map((item) => (
            <span
              key={item.id}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs"
            >
              <span className="font-medium">{item.word}</span>
              <span className="text-muted-foreground">{item.category}</span>
              <button
                type="button"
                onClick={() => remove(item)}
                className="text-muted-foreground transition-colors hover:text-destructive"
                aria-label={`${t("common.delete")} ${item.word}`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
