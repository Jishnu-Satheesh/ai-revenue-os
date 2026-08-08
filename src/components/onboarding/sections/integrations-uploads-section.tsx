"use client";

import { Database, FileUp, Link2 } from "lucide-react";

import { useState } from "react";

import { SectionForm, type SectionSaveStatus } from "@/components/onboarding/sections/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { dataSourceOptions } from "@/domain/onboarding/vocabularies";

export function IntegrationsUploadsSection({
  defaultValues = {},
  onSave,
  onUpload,
  children,
}: {
  defaultValues?: Record<string, unknown>;
  onSave: (payload: Record<string, unknown>, status: SectionSaveStatus) => Promise<void>;
  onUpload?: (file: File) => Promise<void>;
  children?: React.ReactNode;
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
    <SectionForm
      sectionKey="integrations_uploads"
      title="Available sources"
      description="Credentials are created through governed provider flows, never in ordinary fields."
      defaultValues={defaultValues}
      onSave={onSave}
      beforeFields={
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-3">
            {[
              { label: "Provider connection", detail: "Governed handoff", icon: Link2 },
              { label: "Data upload", detail: "Private and source-aware", icon: FileUp },
              { label: "Manual source", detail: "Operator supplied", icon: Database },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <Card key={item.label} size="sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Icon data-icon="inline-start" />
                      {item.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Badge variant="secondary">{item.detail}</Badge>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {onUpload ? (
            <Card size="sm">
              <CardHeader>
                <CardTitle className="text-sm">Upload a source file</CardTitle>
                <CardDescription>
                  Private CSV, text, PDF, PNG, or JPEG files up to 50 MB.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-3">
                <Input
                  type="file"
                  className="max-w-xs"
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
                {uploadError ? (
                  <p className="w-full text-sm text-destructive">{uploadError}</p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      }
      fields={[
        {
          name: "sources",
          label: "Available integrations and files",
          control: "multiselect",
          options: dataSourceOptions,
          placeholder: "Select every source that can be accessed",
          searchPlaceholder: "Search sources…",
          required: true,
        },
        {
          name: "permissions",
          label: "Permission gaps",
          control: "tags",
          placeholder: "Missing read-only performance access",
          description: "Each gap becomes a request the client can action.",
        },
        {
          name: "uploadNotes",
          label: "Upload notes",
          control: "textarea",
          placeholder: "Files still to request from the client",
        },
      ]}
    >
      {children}
    </SectionForm>
  );
}
