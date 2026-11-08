"use client";

import { useEffect, useRef, useState } from "react";
import type { Chart as ChartType } from "chart.js";

interface Props {
  categoryLabels: string[];
  categoryData: number[];
  monthlyLabels: string[];
  monthlyData: number[];
  trendLabels: string[];
  trendData: number[];
}

const isDark = () => document.documentElement.getAttribute("data-theme") === "dark";

export function DashboardCharts(p: Props) {
  const category = useRef<HTMLCanvasElement>(null);
  const monthly = useRef<HTMLCanvasElement>(null);
  const trend = useRef<HTMLCanvasElement>(null);
  const [dark, setDark] = useState(false);

  // Re-draw when the theme toggle flips <html data-theme>.
  useEffect(() => {
    setDark(isDark());
    const obs = new MutationObserver(() => setDark(isDark()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const charts: ChartType[] = [];
    (async () => {
      const { default: Chart } = await import("chart.js/auto");
      if (cancelled) return;
      const text = dark ? "#e2e8f0" : "#1e293b";
      const grid = dark ? "rgba(148, 163, 184, 0.18)" : "rgba(148, 163, 184, 0.25)";
      const common = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: text, usePointStyle: true, padding: 18, font: { size: 12, weight: 600 as const } } },
          tooltip: {
            backgroundColor: dark ? "#0f172a" : "#ffffff",
            titleColor: dark ? "#f8fafc" : "#0f172a",
            bodyColor: dark ? "#e2e8f0" : "#334155",
            borderColor: dark ? "#334155" : "#e2e8f0",
            borderWidth: 1,
            padding: 12,
          },
        },
      };
      const scales = {
        x: { ticks: { color: text }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: text }, grid: { color: grid } },
      };
      if (category.current) {
        charts.push(
          new Chart(category.current, {
            type: "doughnut",
            data: {
              labels: p.categoryLabels,
              datasets: [{ label: "Category Expense", data: p.categoryData, borderWidth: 3, hoverOffset: 12, borderColor: dark ? "#1e293b" : "#ffffff" }],
            },
            options: { ...common, cutout: "58%" },
          }),
        );
      }
      if (monthly.current) {
        charts.push(
          new Chart(monthly.current, {
            type: "bar",
            data: { labels: p.monthlyLabels, datasets: [{ label: "Monthly Expense", data: p.monthlyData, borderRadius: 12, maxBarThickness: 42 }] },
            options: { ...common, scales },
          }),
        );
      }
      if (trend.current) {
        charts.push(
          new Chart(trend.current, {
            type: "line",
            data: {
              labels: p.trendLabels,
              datasets: [{ label: "Expense Trend", data: p.trendData, tension: 0.4, fill: true, pointRadius: 4, pointHoverRadius: 6, borderWidth: 3 }],
            },
            options: { ...common, scales },
          }),
        );
      }
    })();
    return () => {
      cancelled = true;
      charts.forEach((c) => c.destroy());
    };
  }, [dark, p.categoryLabels, p.categoryData, p.monthlyLabels, p.monthlyData, p.trendLabels, p.trendData]);

  return (
    <section className="chart-grid">
      <div className="chart-card">
        <div className="chart-title-row">
          <h3>Category Distribution</h3>
          <span>Doughnut Chart</span>
        </div>
        <canvas ref={category} />
      </div>
      <div className="chart-card">
        <div className="chart-title-row">
          <h3>Monthly Expense</h3>
          <span>Bar Chart</span>
        </div>
        <canvas ref={monthly} />
      </div>
      <div className="chart-card full-width">
        <div className="chart-title-row">
          <h3>Expense Trend</h3>
          <span>Line Chart</span>
        </div>
        <canvas ref={trend} />
      </div>
    </section>
  );
}
