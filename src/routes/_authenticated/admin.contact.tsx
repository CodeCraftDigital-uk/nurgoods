import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { StatusPill } from "@/components/admin/StatusPill";
import { EmptyState } from "@/components/admin/EmptyState";
import { Button } from "@/components/ui/button";
import {
  getEmailReadiness,
  listContactEnquiries,
  setEnquiryHandled,
} from "@/lib/contact/contact.functions";
import { CATEGORY_LABEL, ENQUIRY_STATUS_LABEL } from "@/lib/contact/contact";

export const Route = createFileRoute("/_authenticated/admin/contact")({
  component: ContactEnquiriesPage,
});

function tone(status: string): "positive" | "warning" | "danger" | "neutral" {
  if (status === "email_sent") return "positive";
  if (status === "email_failed" || status === "spam_rejected") return "danger";
  if (status === "email_unconfigured") return "warning";
  return "neutral";
}

function ContactEnquiriesPage() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listContactEnquiries);
  const readinessFn = useServerFn(getEmailReadiness);
  const handledFn = useServerFn(setEnquiryHandled);
  const [open, setOpen] = useState<string | null>(null);

  const enquiries = useQuery({ queryKey: ["contact-enquiries"], queryFn: () => listFn({}) });
  const readiness = useQuery({ queryKey: ["email-readiness"], queryFn: () => readinessFn({}) });

  const toggle = useMutation({
    mutationFn: (input: { id: string; handled: boolean }) => handledFn({ data: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["contact-enquiries"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = enquiries.data ?? [];
  const unhandled = rows.filter((row) => !row.handled).length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Contact Enquiries"
        description="Support messages sent through the storefront contact form. Visible to admins only."
      />

      {readiness.data && !readiness.data.configured ? (
        <SectionCard
          title="Email delivery is not live yet"
          description="Enquiries are stored safely here, but nothing is being emailed out."
        >
          <p className="text-sm text-muted-foreground">
            To have support messages arrive in the support inbox automatically, a verified sender
            domain has to be set up for the brand. Until then, every enquiry is captured on this
            page and marked as awaiting email setup.
          </p>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Inbox"
        description={`${rows.length} stored, ${unhandled} awaiting a reply.`}
      >
        {enquiries.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading enquiries.</p>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No enquiries yet"
            description="Messages sent from the public contact page will appear here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => {
              const expanded = open === row.id;
              return (
                <li key={row.id} className="py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{row.subject}</p>
                      <p className="mt-0.5 break-all text-xs text-muted-foreground">
                        {row.name} · {row.email} ·{" "}
                        {CATEGORY_LABEL[row.category] ?? row.category}
                        {row.order_number ? ` · Order ${row.order_number}` : ""} ·{" "}
                        {new Date(row.created_at).toLocaleString("en-GB")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusPill tone={tone(row.status)}>
                        {ENQUIRY_STATUS_LABEL[row.status] ?? row.status}
                      </StatusPill>
                      {row.handled ? (
                        <StatusPill tone="positive">Handled</StatusPill>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="min-h-9"
                      onClick={() => setOpen(expanded ? null : row.id)}
                    >
                      {expanded ? "Close" : "Read message"}
                    </Button>
                    <Button
                      variant="outline"
                      className="min-h-9"
                      onClick={() => toggle.mutate({ id: row.id, handled: !row.handled })}
                      disabled={toggle.isPending}
                    >
                      {row.handled ? "Mark as open" : "Mark as handled"}
                    </Button>
                    <Button asChild variant="outline" className="min-h-9">
                      <a href={`mailto:${row.email}?subject=Re: ${encodeURIComponent(row.subject)}`}>
                        Reply by email
                      </a>
                    </Button>
                  </div>

                  {expanded ? (
                    <div className="mt-3 space-y-2">
                      <p className="whitespace-pre-wrap rounded-md bg-muted/60 px-3 py-3 text-sm text-foreground">
                        {row.message}
                      </p>
                      {row.delivery_error ? (
                        <p className="text-xs text-muted-foreground">{row.delivery_error}</p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
