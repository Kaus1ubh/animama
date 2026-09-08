import type { ReactNode } from "react";

type RouteViewProps = {
  eyebrow: string;
  title: string;
  description: string;
  items?: string[];
  actions?: ReactNode;
  aside?: ReactNode;
};

export function RouteView({
  eyebrow,
  title,
  description,
  items,
  actions,
  aside,
}: RouteViewProps) {
  return (
    <section className="route-view">
      <div>
        <p className="route-eyebrow">{eyebrow}</p>
        <h2 className="route-title">{title}</h2>
        <p className="route-description">{description}</p>
        {items?.length ? (
          <ul className="route-list">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        {actions ? <div className="route-actions">{actions}</div> : null}
      </div>
      {aside ? <aside className="route-aside">{aside}</aside> : null}
    </section>
  );
}
