import { Card, CardBody } from "@heroui/react";
import { LucideIcon } from "lucide-react";

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  color: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

export default function StatsCard({
  title,
  value,
  icon: Icon,
  color,
  trend,
}: StatsCardProps) {
  return (
    <Card className="app-surface border border-[var(--color-border)]">
      <CardBody className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] app-muted">
              {title}
            </p>
            <p className="mt-2 text-2xl font-extrabold text-[var(--color-ink)] sm:text-3xl">
              {value}
            </p>
            {trend && (
              <p
                className={`mt-2 text-xs font-semibold ${trend.isPositive ? "text-emerald-600" : "text-rose-600"}`}
              >
                {trend.isPositive ? "UP" : "DOWN"} {Math.abs(trend.value)}% from
                last month
              </p>
            )}
          </div>
          <div className={`rounded-2xl p-3 ${color}`}>
            <Icon size={24} className="text-white" />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
