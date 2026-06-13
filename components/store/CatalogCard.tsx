import type { ReactNode } from "react";

// The single canonical catalog card. Store Agents, Store Tools, and any other
// catalog-like surface route through this one anatomy so they cannot drift into
// "two different apps": media (logo/avatar) · name · secondary category · one-line
// description · a quiet signal row (≤2 dot+text signals) · a footer action row.
export function CatalogCard({
  media,
  name,
  category,
  description,
  signals,
  footer
}: {
  media: ReactNode;
  name: string;
  category?: string;
  description?: string;
  signals?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <article className="catalogCard">
      <div className="catalogCardHead">
        {media}
        <div className="catalogCardTitle">
          <h3 title={name}>{name}</h3>
          {category && <span className="catalogCardCategory">{category}</span>}
        </div>
      </div>
      {description && <p className="catalogCardDesc">{description}</p>}
      {signals && <div className="catalogCardSignals">{signals}</div>}
      {footer && <div className="catalogCardFooter">{footer}</div>}
    </article>
  );
}
