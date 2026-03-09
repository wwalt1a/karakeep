"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import FilePickerButton from "@/components/ui/file-picker-button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/components/ui/sonner";
import { useBookmarkImport } from "@/lib/hooks/useBookmarkImport";
import { useTranslation } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Download, Loader2, Upload } from "lucide-react";

import { Card, CardContent } from "../ui/card";
import { ImportSessionsSection } from "./ImportSessionsSection";
import { SettingsPage, SettingsSection } from "./SettingsPage";

function ImportCard({
  text,
  description,
  children,
}: {
  text: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="transition-all hover:shadow-md">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-full bg-primary/10 p-2">
          <Download className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-medium">{text}</h3>
          <p>{description}</p>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

async function extractSingleFileUrl(file: File): Promise<string> {
  const slice = file.slice(0, 500);
  const text = await slice.text();
  const match = text.match(/^\s*url:\s*(\S+)/m);
  if (match) {
    return match[1];
  }
  // Fallback: use filename with trailing timestamp parentheses stripped
  return file.name.replace(/\s*\([^)]*\)\s*\.html$/i, "").trim() || file.name;
}

function SingleFileImportCard() {
  const { t } = useTranslation();
  const [concurrency, setConcurrency] = useState(5);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (fileList: FileList) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;
      setIsUploading(true);
      setProgress({ done: 0, total: files.length });

      const failed: string[] = [];
      let done = 0;

      // Concurrency pool: run at most `concurrency` uploads simultaneously
      const queue = [...files];
      const workerCount = Math.min(concurrency, files.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (queue.length > 0) {
          const file = queue.shift();
          if (!file) break;
          try {
            const url = await extractSingleFileUrl(file);
            const formData = new FormData();
            formData.append("url", url);
            formData.append("file", file);
            const resp = await fetch(
              "/api/v1/bookmarks/singlefile?ifexists=append",
              {
                method: "POST",
                body: formData,
              },
            );
            if (!resp.ok) {
              failed.push(file.name);
            }
          } catch {
            failed.push(file.name);
          }
          done += 1;
          setProgress({ done, total: files.length });
        }
      });

      await Promise.all(workers);
      setIsUploading(false);
      setProgress(null);
      // Reset input so the same files can be selected again
      if (fileInputRef.current) fileInputRef.current.value = "";

      if (failed.length === 0) {
        toast({
          description: t(
            "settings.import.import_singlefile_success",
            { count: files.length },
          ),
          variant: "default",
        });
      } else {
        const fileSummary =
          failed.slice(0, 5).join(", ") +
          (failed.length > 5 ? ` +${failed.length - 5} more` : "");
        toast({
          description: t("settings.import.import_singlefile_result", {
            success: files.length - failed.length,
            failed: failed.length,
            files: fileSummary,
          }),
          variant: "destructive",
        });
      }
    },
    [concurrency, t],
  );

  return (
    <ImportCard
      text={t("settings.import.import_singlefile_snapshots")}
      description={t(
        "settings.import.import_singlefile_snapshots_description",
      )}
    >
      <div className="flex flex-col items-end gap-2">
        <div className="flex w-48 flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            {t("settings.import.import_singlefile_concurrency", {
              count: concurrency,
            })}
          </span>
          <Slider
            min={1}
            max={20}
            step={1}
            value={[concurrency]}
            onValueChange={([v]) => setConcurrency(v)}
            disabled={isUploading}
          />
        </div>
        <Button
          size="sm"
          disabled={isUploading}
          className="flex items-center gap-2"
          onClick={() => fileInputRef.current?.click()}
        >
          {isUploading && <Loader2 className="h-4 w-4 animate-spin" />}
          <p>
            {isUploading
              ? t("settings.import.import_singlefile_importing")
              : t("settings.import.import_singlefile_select_files")}
          </p>
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".html"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              handleFiles(e.target.files);
            }
          }}
        />
      </div>
      {progress && (
        <div className="mt-2 flex w-full flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            {t("settings.import.import_singlefile_processed", {
              done: progress.done,
              total: progress.total,
            })}
          </span>
          <Progress value={(progress.done * 100) / progress.total} />
        </div>
      )}
    </ImportCard>
  );
}

function ExportButton() {
  const { t } = useTranslation();
  const [format, setFormat] = useState<"json" | "netscape">("json");
  const queryClient = useQueryClient();
  const { isFetching, refetch, error } = useQuery({
    queryKey: ["exportBookmarks"],
    queryFn: async () => {
      const res = await fetch(`/api/bookmarks/export?format=${format}`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error?.error || "Failed to export bookmarks");
      }
      const match = res.headers
        .get("Content-Disposition")
        ?.match(/filename\*?=(?:UTF-8''|")?([^"]+)/i);
      const filename = match
        ? match[1]
        : `karakeep-export-${new Date().toISOString()}.${format}`;
      return { blob: res.blob(), filename };
    },
    enabled: false,
  });

  useEffect(() => {
    if (error) {
      toast({
        description: error.message,
        variant: "destructive",
      });
    }
  }, [error]);

  const onExport = useCallback(async () => {
    const { data } = await refetch();
    if (!data) return;
    const { blob, filename } = data;
    const url = window.URL.createObjectURL(await blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
    queryClient.setQueryData(["exportBookmarks"], () => null);
  }, [refetch]);

  return (
    <Card className="transition-all hover:shadow-md">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-full bg-primary/10 p-2">
          <Upload className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-medium">Export File</h3>
          <p>{t("settings.import.export_links_and_notes")}</p>
          <Select
            value={format}
            onValueChange={(value) => setFormat(value as "json" | "netscape")}
          >
            <SelectTrigger className="mt-2 w-[180px]">
              <SelectValue placeholder="Format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="json">JSON (Karakeep format)</SelectItem>
              <SelectItem value="netscape">HTML (Netscape format)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          className={cn(
            buttonVariants({ variant: "default", size: "sm" }),
            "flex items-center gap-2",
          )}
          onClick={onExport}
          disabled={isFetching}
        >
          {isFetching && <Loader2 className="mr-2 animate-spin" />}
          <p>Export</p>
        </Button>
      </CardContent>
    </Card>
  );
}

export function ImportExportRow() {
  const { t } = useTranslation();
  const { importProgress, quotaError, runUploadBookmarkFile } =
    useBookmarkImport();

  return (
    <div className="flex flex-col gap-3">
      {quotaError && (
        <Alert variant="destructive" className="relative">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Import Quota Exceeded</AlertTitle>
          <AlertDescription>{quotaError}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <ImportCard
          text="HTML File"
          description={t("settings.import.import_bookmarks_from_html_file")}
        >
          <FilePickerButton
            size={"sm"}
            loading={false}
            accept=".html"
            multiple={false}
            className="flex items-center gap-2"
            onFileSelect={(file) =>
              runUploadBookmarkFile({ file, source: "html" })
            }
          >
            <p>Import</p>
          </FilePickerButton>
        </ImportCard>
        <ImportCard
          text="Pocket"
          description={t("settings.import.import_bookmarks_from_pocket_export")}
        >
          <FilePickerButton
            size={"sm"}
            loading={false}
            accept=".csv"
            multiple={false}
            className="flex items-center gap-2"
            onFileSelect={(file) =>
              runUploadBookmarkFile({ file, source: "pocket" })
            }
          >
            <p>Import</p>
          </FilePickerButton>
        </ImportCard>
        <ImportCard
          text="Matter"
          description={t("settings.import.import_bookmarks_from_matter_export")}
        >
          <FilePickerButton
            size={"sm"}
            loading={false}
            accept=".csv"
            multiple={false}
            className="flex items-center gap-2"
            onFileSelect={(file) =>
              runUploadBookmarkFile({ file, source: "matter" })
            }
          >
            <p>Import</p>
          </FilePickerButton>
        </ImportCard>
        <ImportCard
          text="Omnivore"
          description={t(
            "settings.import.import_bookmarks_from_omnivore_export",
          )}
        >
          <FilePickerButton
            size={"sm"}
            loading={false}
            accept=".json"
            multiple={false}
            className="flex items-center gap-2"
            onFileSelect={(file) =>
              runUploadBookmarkFile({ file, source: "omnivore" })
            }
          >
            <p>Import</p>
          </FilePickerButton>
        </ImportCard>
        <ImportCard
          text="Linkwarden"
          description={t(
            "settings.import.import_bookmarks_from_linkwarden_export",
          )}
        >
          <FilePickerButton
            size={"sm"}
            loading={false}
            accept=".json"
            multiple={false}
            className="flex items-center gap-2"
            onFileSelect={(file) =>
              runUploadBookmarkFile({ file, source: "linkwarden" })
            }
          >
            <p>Import</p>
          </FilePickerButton>
        </ImportCard>
        <ImportCard
          text="Tab Session Manager"
          description={t(
            "settings.import.import_bookmarks_from_tab_session_manager_export",
          )}
        >
          <FilePickerButton
            size={"sm"}
            loading={false}
            accept=".json"
            multiple={false}
            className="flex items-center gap-2"
            onFileSelect={(file) =>
              runUploadBookmarkFile({ file, source: "tab-session-manager" })
            }
          >
            <p>Import</p>
          </FilePickerButton>
        </ImportCard>
        <ImportCard
          text="mymind"
          description={t("settings.import.import_bookmarks_from_mymind_export")}
        >
          <FilePickerButton
            size={"sm"}
            loading={false}
            accept=".csv"
            multiple={false}
            className="flex items-center gap-2"
            onFileSelect={(file) =>
              runUploadBookmarkFile({ file, source: "mymind" })
            }
          >
            <p>Import</p>
          </FilePickerButton>
        </ImportCard>
        <ImportCard
          text="Instapaper"
          description={t(
            "settings.import.import_bookmarks_from_instapaper_export",
          )}
        >
          <FilePickerButton
            size={"sm"}
            loading={false}
            accept=".csv"
            multiple={false}
            className="flex items-center gap-2"
            onFileSelect={(file) =>
              runUploadBookmarkFile({ file, source: "instapaper" })
            }
          >
            <p>Import</p>
          </FilePickerButton>
        </ImportCard>
        <ImportCard
          text="Karakeep"
          description={t(
            "settings.import.import_bookmarks_from_karakeep_export",
          )}
        >
          <FilePickerButton
            size={"sm"}
            loading={false}
            accept=".json"
            multiple={false}
            className="flex items-center gap-2"
            onFileSelect={(file) =>
              runUploadBookmarkFile({ file, source: "karakeep" })
            }
          >
            <p>Import</p>
          </FilePickerButton>
        </ImportCard>
        <SingleFileImportCard />
        <ExportButton />
      </div>
      {importProgress && (
        <div className="flex flex-col gap-2">
          <p className="shrink-0 text-sm">
            Processed {importProgress.done} of {importProgress.total} bookmarks
          </p>
          <div className="w-full">
            <Progress
              value={(importProgress.done * 100) / importProgress.total}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function ImportExport() {
  const { t } = useTranslation();
  return (
    <SettingsPage title={t("settings.import.import_export")}>
      <SettingsSection title={t("settings.import.import_export_bookmarks")}>
        <ImportExportRow />
      </SettingsSection>

      <ImportSessionsSection />
    </SettingsPage>
  );
}
