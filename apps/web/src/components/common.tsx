import { ReactNode } from "react";

export function Metric({ label, value, total, tone }: { label: string; value: number; total?: number; tone?: "warn" }) {
  return (
    <div className={`metric ${tone || ""}`}>
      <span>{label}</span>
      <strong>
        {value}
        {typeof total === "number" ? <span className="metric-total">/{total}</span> : null}
      </strong>
    </div>
  );
}

export function Badge({ value }: { value: string }) {
  return <span className="badge">{value}</span>;
}

export function ListSection<T>({ title, items, render }: { title: string; items: T[]; render: (item: T) => ReactNode }) {
  return (
    <section className="list-section">
      <div className="section-title">
        <h2>{title}</h2>
      </div>
      <div className="list-stack">
        {items?.length ? items.map((item, index) => <div key={index}>{render(item)}</div>) : <EmptyState text="暂无数据" />}
      </div>
    </section>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
