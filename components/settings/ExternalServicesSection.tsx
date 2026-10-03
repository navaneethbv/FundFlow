import Panel from "@/components/ui/Panel";
import { EXTERNAL_SERVICES } from "@/lib/external-services";

export default function ExternalServicesSection() {
  return (
    <Panel
      eyebrow="Privacy"
      title="External services"
    >
      <p className="mb-5 max-w-3xl text-sm text-muted">
        FundFlow keeps this registry next to the source files that make each
        outbound call. Optional services stay idle until you enable or use the
        related feature.
      </p>
      <div className="grid gap-4 xl:grid-cols-2">
        {EXTERNAL_SERVICES.map((service) => (
          <article
            key={service.key}
            className="rounded-card border border-panel-border bg-panel-hover/30 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="card-title text-lg">{service.name}</h2>
              <span className="rounded-full border border-panel-border px-2 py-1 text-xs font-semibold text-muted">
                {service.optionality}
              </span>
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="eyebrow">Purpose</dt>
                <dd className="mt-1 text-foreground">{service.purpose}</dd>
              </div>
              <div>
                <dt className="eyebrow">Data sent or received</dt>
                <dd className="mt-1 text-foreground">{service.dataSent}</dd>
              </div>
              <div>
                <dt className="eyebrow">When it runs</dt>
                <dd className="mt-1 text-foreground">{service.trigger}</dd>
              </div>
              <div>
                <dt className="eyebrow">Source files</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {service.sourceFiles.map((sourceFile) => (
                    <code
                      key={sourceFile}
                      className="rounded-field bg-panel px-1.5 py-0.5 text-xs text-muted"
                    >
                      {sourceFile}
                    </code>
                  ))}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </Panel>
  );
}
