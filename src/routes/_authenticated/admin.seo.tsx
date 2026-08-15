import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { StatusPill, statusTone, humanise } from "@/components/admin/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createSeoEntity,
  createSeoRecord,
  listSeoEntities,
  listSeoRecords,
  updateSeoRecord,
} from "@/lib/services/seo";
import {
  OPTIMISATION_STATUS_LABEL,
  type OptimisationStatus,
  type SeoTargetType,
} from "@/lib/types/platform";

export const Route = createFileRoute("/_authenticated/admin/seo")({
  component: SeoPage,
});

const TARGET_TYPES: SeoTargetType[] = ["product", "collection", "article", "page"];
const STATUSES = Object.keys(OPTIMISATION_STATUS_LABEL) as OptimisationStatus[];

function SeoPage() {
  const queryClient = useQueryClient();
  const records = useQuery({ queryKey: ["seo-records"], queryFn: listSeoRecords });
  const entities = useQuery({ queryKey: ["seo-entities"], queryFn: listSeoEntities });

  const [targetType, setTargetType] = useState<SeoTargetType>("product");
  const [reference, setReference] = useState("");
  const [query, setQuery] = useState("");
  const [entityName, setEntityName] = useState("");

  const addRecord = useMutation({
    mutationFn: () =>
      createSeoRecord({
        targetType,
        targetReference: reference.trim(),
        targetQuery: query.trim() || null,
      }),
    onSuccess: async () => {
      setReference("");
      setQuery("");
      await queryClient.invalidateQueries({ queryKey: ["seo-records"] });
      toast.success("SEO record created");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const addEntity = useMutation({
    mutationFn: () => createSeoEntity({ name: entityName.trim() }),
    onSuccess: async () => {
      setEntityName("");
      await queryClient.invalidateQueries({ queryKey: ["seo-entities"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OptimisationStatus }) =>
      updateSeoRecord(id, { optimisation_status: status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["seo-records"] }),
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="SEO Intelligence"
        title="Query, entity and metadata coverage"
        description="Track target query, search intent, entities, FAQs, internal link targets, title, meta description, canonical, schema type and optimisation status for every product, collection, article and page."
      />

      <SectionCard title="Add a record">
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1.5fr_1.5fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reference.trim()) {
              toast.error("Add a target reference");
              return;
            }
            addRecord.mutate();
          }}
        >
          <div className="space-y-2">
            <Label>Target type</Label>
            <Select value={targetType} onValueChange={(v) => setTargetType(v as SeoTargetType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TARGET_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {humanise(type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reference">Target reference</Label>
            <Input
              id="reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Handle, slug or path"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="query">Target query</Label>
            <Input
              id="query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Primary query"
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={addRecord.isPending} className="w-full sm:w-auto">
              Add
            </Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Records">
        {(records.data ?? []).length === 0 ? (
          <EmptyState
            icon={Search}
            title="No SEO records yet"
            description="Add a record by hand, or let the catalogue sync and Journal workflow create them automatically."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Target</TableHead>
                  <TableHead>Query</TableHead>
                  <TableHead>Intent</TableHead>
                  <TableHead>Schema</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(records.data ?? []).map((record) => (
                  <TableRow key={record.id}>
                    <TableCell>
                      <p className="font-medium">{record.target_reference}</p>
                      <p className="text-xs text-muted-foreground">
                        {humanise(record.target_type)}
                      </p>
                    </TableCell>
                    <TableCell>{record.target_query ?? "Not set"}</TableCell>
                    <TableCell>{record.search_intent ?? "Not set"}</TableCell>
                    <TableCell>{record.schema_type ?? "Not set"}</TableCell>
                    <TableCell>
                      <Select
                        value={record.optimisation_status}
                        onValueChange={(v) =>
                          setStatus.mutate({ id: record.id, status: v as OptimisationStatus })
                        }
                      >
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((status) => (
                            <SelectItem key={status} value={status}>
                              {OPTIMISATION_STATUS_LABEL[status]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Entities"
        description="Named entities that give answer engines clarity about what the content covers."
      >
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!entityName.trim()) return;
            addEntity.mutate();
          }}
        >
          <Input
            value={entityName}
            onChange={(e) => setEntityName(e.target.value)}
            placeholder="Entity name"
          />
          <Button type="submit" disabled={addEntity.isPending}>
            Add entity
          </Button>
        </form>
        <div className="mt-4 flex flex-wrap gap-2">
          {(entities.data ?? []).map((entity) => (
            <StatusPill key={entity.id} tone={statusTone(null)}>
              {entity.name}
            </StatusPill>
          ))}
          {(entities.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No entities recorded yet.</p>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}
