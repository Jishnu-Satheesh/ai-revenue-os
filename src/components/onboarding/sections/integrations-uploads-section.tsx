"use client";

import { Database, FileUp, Link2 } from "lucide-react";

import { useState } from "react";

import { SectionForm, type SectionSaveStatus } from "@/components/onboarding/sections/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export function IntegrationsUploadsSection({
  defaultValues = {},
  onSave,
  onUpload,
}: {
  defaultValues?: Record<string, string>;
  onSave: (payload: Record<string, string>, status: SectionSaveStatus) => Promise<void>;
  onUpload?: (file: File) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function upload() {
    if (!file || !onUpload) return;
    setUploading(true);
    setUploadError(null);
    try {
      await onUpload(file);
      setFile(null);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "File upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 md:grid-cols-3">
        {[
          { label: "Provider connection", detail: "Governed handoff", icon: Link2 },
          { label: "Data upload", detail: "Private and source-aware", icon: FileUp },
          { label: "Manual source", detail: "Operator supplied", icon: Database },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.label} className="py-4">
              <CardHeader className="px-4 pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Icon data-icon="inline-start" />
                  {item.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <Badge variant="secondary">{item.detail}</Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {onUpload ? (
        <Card>
          <CardHeader className="px-4 pb-2">
            <CardTitle className="text-sm">Upload a source file</CardTitle>
            <CardDescription>
              Private CSV, text, PDF, PNG, or JPEG files up to 50 MB.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3 px-4">
            <Input
              type="file"
              accept=".csv,.txt,.pdf,.png,.jpg,.jpeg,text/csv,text/plain,application/pdf,image/png,image/jpeg"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <Button type="button" disabled={!file || uploading} onClick={() => void upload()}>
              {uploading ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <FileUp data-icon="inline-start" />
              )}
              Upload source
            </Button>
            {uploadError ? <p className="w-full text-sm text-destructive">{uploadError}</p> : null}
          </CardContent>
        </Card>
      ) : null}
      <SectionForm
        title="Available sources"
        description="Credentials are created through governed provider flows, never in ordinary fields."
        defaultValues={defaultValues}
        onSave={onSave}
        fields={[
          {
            name: "sources",
            label: "Available integrations and files",
            placeholder: "POS export; Google Business Profile",
            required: true,
            multiline: true,
          },
          {
            name: "permissions",
            label: "Permission gaps",
            placeholder: "Missing read-only performance access",
          },
          {
            name: "uploadNotes",
            label: "Upload notes",
            placeholder: "Files to request from the client",
            multiline: true,
          },
        ]}
      />
    </div>
  );
}
