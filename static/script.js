document.addEventListener("DOMContentLoaded", function () {
    const savedTheme = localStorage.getItem("theme") || "light";
    document.documentElement.setAttribute("data-theme", savedTheme);

    const themeToggle = document.getElementById("themeToggle");
    if (themeToggle) {
        themeToggle.textContent = savedTheme === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode";

        themeToggle.addEventListener("click", function () {
            const currentTheme = document.documentElement.getAttribute("data-theme");
            const newTheme = currentTheme === "dark" ? "light" : "dark";

            document.documentElement.setAttribute("data-theme", newTheme);
            localStorage.setItem("theme", newTheme);
            themeToggle.textContent = newTheme === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode";
        });
    }

    const counters = document.querySelectorAll(".counter");
    counters.forEach(counter => {
        const target = parseFloat(counter.getAttribute("data-target")) || 0;
        const duration = 1200;
        const startTime = performance.now();

        function updateCounter(currentTime) {
            const progress = Math.min((currentTime - startTime) / duration, 1);
            const currentValue = target * progress;
            counter.textContent = "₹ " + currentValue.toFixed(2);

            if (progress < 1) {
                requestAnimationFrame(updateCounter);
            } else {
                counter.textContent = "₹ " + target.toFixed(2);
            }
        }

        requestAnimationFrame(updateCounter);
    });

    const isDark = () => document.documentElement.getAttribute("data-theme") === "dark";

    function getChartTextColor() {
        return isDark() ? "#e2e8f0" : "#1e293b";
    }

    function getGridColor() {
        return isDark() ? "rgba(148, 163, 184, 0.18)" : "rgba(148, 163, 184, 0.25)";
    }

    function getLegendLabelStyle() {
        return {
            color: getChartTextColor(),
            usePointStyle: true,
            padding: 18,
            font: {
                size: 12,
                weight: "600"
            }
        };
    }

    let categoryChartInstance = null;
    let monthlyChartInstance = null;
    let trendChartInstance = null;

    function destroyExistingCharts() {
        if (categoryChartInstance) categoryChartInstance.destroy();
        if (monthlyChartInstance) monthlyChartInstance.destroy();
        if (trendChartInstance) trendChartInstance.destroy();
    }

    function renderCharts() {
        destroyExistingCharts();

        const commonOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: getLegendLabelStyle()
                },
                tooltip: {
                    backgroundColor: isDark() ? "#0f172a" : "#ffffff",
                    titleColor: isDark() ? "#f8fafc" : "#0f172a",
                    bodyColor: isDark() ? "#e2e8f0" : "#334155",
                    borderColor: isDark() ? "#334155" : "#e2e8f0",
                    borderWidth: 1,
                    padding: 12
                }
            }
        };

        if (document.getElementById("categoryChart")) {
            categoryChartInstance = new Chart(document.getElementById("categoryChart"), {
                type: "doughnut",
                data: {
                    labels: categoryLabels,
                    datasets: [{
                        label: "Category Expense",
                        data: categoryData,
                        borderWidth: 3,
                        hoverOffset: 12,
                        borderColor: isDark() ? "#1e293b" : "#ffffff"
                    }]
                },
                options: {
                    ...commonOptions,
                    cutout: "58%"
                }
            });
        }

        if (document.getElementById("monthlyChart")) {
            monthlyChartInstance = new Chart(document.getElementById("monthlyChart"), {
                type: "bar",
                data: {
                    labels: monthlyLabels,
                    datasets: [{
                        label: "Monthly Expense",
                        data: monthlyData,
                        borderRadius: 12,
                        maxBarThickness: 42
                    }]
                },
                options: {
                    ...commonOptions,
                    scales: {
                        x: {
                            ticks: {
                                color: getChartTextColor()
                            },
                            grid: {
                                display: false
                            }
                        },
                        y: {
                            beginAtZero: true,
                            ticks: {
                                color: getChartTextColor()
                            },
                            grid: {
                                color: getGridColor()
                            }
                        }
                    }
                }
            });
        }

        if (document.getElementById("trendChart")) {
            trendChartInstance = new Chart(document.getElementById("trendChart"), {
                type: "line",
                data: {
                    labels: trendLabels,
                    datasets: [{
                        label: "Expense Trend",
                        data: trendData,
                        tension: 0.4,
                        fill: true,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        borderWidth: 3
                    }]
                },
                options: {
                    ...commonOptions,
                    scales: {
                        x: {
                            ticks: {
                                color: getChartTextColor()
                            },
                            grid: {
                                display: false
                            }
                        },
                        y: {
                            beginAtZero: true,
                            ticks: {
                                color: getChartTextColor()
                            },
                            grid: {
                                color: getGridColor()
                            }
                        }
                    }
                }
            });
        }
    }

    renderCharts();

    if (themeToggle) {
        themeToggle.addEventListener("click", function () {
            setTimeout(() => {
                renderCharts();
            }, 100);
        });
    }
});