#!/usr/bin/env python3
"""Run the pre-registered statistical tests (PREREGISTRATION.md) on the dashboard data.

Writes data/tests.json, which the dashboard's Tests view reads. Two ways to run it:

    ~/.venvs/record-stats/bin/python run_tests.py              # the full run, on the workstation
    python3 analysis/run_tests.py --site-only                  # what the nightly refresh runs

The full run also writes the figures in figures/ and results-full.json, which the
written report embeds, and needs matplotlib. --site-only writes data/tests.json
and nothing else, needs only the libraries in requirements-stats.txt, and is what
keeps the Tests page current as the feeds move: every number in the page's
headlines and primer is computed from the results, not typed.

Because the text is computed, it can become untrue: if a result changes so that a
headline claim (a ceasefire cutting the rate, a ratio above four, a share above a
half) no longer holds, the run stops before writing and names the claim, so the
site keeps the last text that was true. Edit build_primer or build_findings then.

The master copy is the one beside the report; publish.py copies it into the site
repository. The full named list is downloaded when the cached copy is more than a
day old (cache/, not committed); the dashboard itself ships only a one-in-three
sample of it.
"""
import datetime as dt
import glob
import html
import json
import math
import pathlib
import re
import subprocess
import sys
import time
import urllib.request
from collections import Counter, defaultdict

# --site-only is the mode the nightly refresh runs in: it writes data/tests.json
# and nothing else, so it needs neither matplotlib nor the figures directory.
SITE_ONLY = "--site-only" in sys.argv
if SITE_ONLY:
    from unittest.mock import MagicMock
    plt = MagicMock()
    plt.subplots.return_value = (MagicMock(), MagicMock())
else:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
import numpy as np
import openpyxl
import statsmodels.api as sm
from scipy import stats
from statsmodels.stats.multitest import multipletests
from statsmodels.stats.proportion import proportion_confint

HERE = pathlib.Path(__file__).resolve().parent
# On the workstation the dashboard is a sibling folder; in the site repository the
# analysis folder sits inside it.
DASH = HERE.parent / "dashboard" if (HERE.parent / "dashboard").is_dir() else HERE.parent
DATA = DASH / "data"
RAW = DATA / "raw"
FIG = HERE / "figures"
CACHE = HERE / "cache"
if not SITE_ONLY:
    FIG.mkdir(exist_ok=True)
CACHE.mkdir(exist_ok=True)

NAMES_URL = "https://data.techforpalestine.org/api/v2/killed-in-gaza.min.json"
PREREG = "reports/israel-palestine/analysis/PREREGISTRATION.md"

plt.rcParams.update({"font.size": 9, "axes.spines.top": False, "axes.spines.right": False,
                     "figure.dpi": 150, "savefig.bbox": "tight"})
RED, BLUE, GREY, GREEN = "#b23a3a", "#3a6ea5", "#8a8a8a", "#2f7d4f"

TESTS = []
DEPARTURES = []
SERIES = {}


def record(**t):
    TESTS.append(t)
    return t


def ci(lo, hi):
    return [float(lo), float(hi)]


def iso(s):
    return dt.date.fromisoformat(s)


# ---------------------------------------------------------------- data

def named_list():
    """The Ministry of Health named list, refreshed when the cached copy is more
    than a day old. A failed download falls back to the cache; with no cache the
    run stops, which the nightly refresh treats as a step that degraded."""
    path = CACHE / "killed-in-gaza.min.json"
    fresh = path.exists() and time.time() - path.stat().st_mtime < 20 * 3600
    if not fresh:
        req = urllib.request.Request(NAMES_URL, headers={"User-Agent": "curl/8"})
        for attempt in (1, 2, 3):
            try:
                data = urllib.request.urlopen(req, timeout=300).read()
                json.loads(data)  # refuse a truncated download
                path.write_bytes(data)
                break
            except Exception as err:
                print(f"named list download failed (attempt {attempt} of 3): {err}", file=sys.stderr)
                time.sleep(attempt * 15)
        else:
            if not path.exists():
                raise SystemExit("named list unavailable and no cached copy")
    return json.loads(path.read_text(encoding="utf-8"))


def gaza_population():
    wb = openpyxl.load_workbook(RAW / "pse_admpop_2023.xlsx", read_only=True)
    rows = list(wb["pse_admpop_adm1_2023"].iter_rows(values_only=True))
    head, gaza = rows[0], next(r for r in rows[1:] if r[5] == "PS02")
    rec = dict(zip(head, gaza))
    bands = ["00_04", "05_09", "10_14", "15_19", "20_24", "25_29", "30_34", "35_39",
             "40_44", "45_49", "50_54", "55_59", "60_64", "65_69", "70_74", "75_79", "80Plus"]
    return bands, [rec["M_" + b] for b in bands], [rec["F_" + b] for b in bands], rec["T_TL"]


def daily():
    return json.loads((RAW / "v2_casualties_daily.min.json").read_text())


# ---------------------------------------------------------------- models

def nb_alpha(y, X):
    """Overdispersion: maximum-likelihood NB alpha, and the LR test against Poisson."""
    pois = sm.GLM(y, X, family=sm.families.Poisson()).fit()
    nb = sm.NegativeBinomial(y, X).fit(disp=0, maxiter=500)
    alpha = float(nb.params[-1])
    lr = 2 * (nb.llf - pois.llf)
    p = 0.5 * stats.chi2.sf(lr, 1)  # boundary: half chi-square(1)
    return alpha, float(p)


def nb_hac(y, X, lags=7):
    alpha, p_over = nb_alpha(y, X)
    if p_over >= 0.05:
        fam, alpha = sm.families.Poisson(), 0.0
    else:
        fam = sm.families.NegativeBinomial(alpha=alpha)
    res = sm.GLM(y, X, family=fam).fit(cov_type="HAC", cov_kwds={"maxlags": lags})
    return res, alpha, p_over


# ---------------------------------------------------------------- H1

def h1(people):
    bands, pm, pf, total_pop = gaza_population()
    edges = list(range(0, 80, 5))

    def band(a):
        return min(a // 5, 16)

    om, of = [0] * 17, [0] * 17
    for p in people:
        (om if p["sex"] == "m" else of)[band(int(p["age"]))] += 1
    obs = np.array(om + of, float)
    pop = np.array(pm + pf, float)
    n = obs.sum()
    exp = n * pop / pop.sum()
    chi2, p = stats.chisquare(obs, exp)
    v = math.sqrt(chi2 / (n * (len(obs) - 1)))
    ratio = obs / exp
    labels = [f"{e}-{e+4}" for e in edges] + ["80+"]
    cells = [{"sex": s, "band": labels[i], "observed": int(obs[j]), "expected": round(float(exp[j]), 1),
              "ratio": round(float(ratio[j]), 3), "population": int(pop[j])}
             for j, (s, i) in enumerate([("m", i) for i in range(17)] + [("f", i) for i in range(17)])]
    record(id="H1a", group="H1", title="Age and sex of the dead against the population: indiscriminate pattern",
           null="The identified dead are distributed across sex and age in proportion to the population of Gaza.",
           data=f"Ministry of Health named list, {int(n):,} identified dead; PCBS/UNFPA Gaza Strip population 2023 ({total_pop:,}).",
           test="Chi-square goodness of fit, 34 sex-age cells", statistic={"chi2": round(chi2, 1), "df": len(obs) - 1},
           p=float(p), effect={"name": "Cramér's V", "value": round(v, 3)},
           cells=cells, ref="§6.1")

    # H1b: share outside men 18-59
    wce = sum(1 for p in people if p["sex"] == "f" or int(p["age"]) < 18 or int(p["age"]) >= 60)
    share = wce / n
    lo, hi = proportion_confint(wce, n, method="wilson")
    # population share of the same group; 15-19 split 3:2 to place the 18th birthday
    under18 = sum(pm[:3]) + sum(pf[:3]) + 0.6 * (pm[3] + pf[3])
    men_18_59 = 0.4 * pm[3] + sum(pm[4:12])
    pop_share = 1 - men_18_59 / total_pop
    p_b = 0.0 if wce else 1.0  # under a null share of zero, a single case outside the group rejects it
    men = int(n) - wce
    record(id="H1b", group="H1", title="Age and sex of the dead: pattern confined to men of fighting age",
           null="The identified dead are confined to men aged 18-59.",
           data=f"Ministry of Health named list, {int(n):,} identified dead; PCBS/UNFPA Gaza Strip population 2023 ({total_pop:,}).", test="Exact binomial test of the share of women, children and people aged 60 and over against zero",
           statistic={"women_children_elderly": wce, "men_18_59": men, "n": int(n)},
           p=float(p_b), effect={"name": "Share of dead who are women, children under 18 or aged 60+", "value": round(share, 4),
                                 "ci": ci(lo, hi), "population_share": round(pop_share, 4)},
           ref="§6.1")

    ratios = []
    for i in range(17):
        ratios.append({"band": labels[i], "dead_m_per_f": round(om[i] / of[i], 2) if of[i] else None,
                       "pop_m_per_f": round(pm[i] / pf[i], 2)})
    TESTS[-2]["sex_ratios"] = ratios

    # figure: observed/expected by cell
    fig, ax = plt.subplots(figsize=(7, 3.4))
    x = np.arange(17)
    ax.bar(x - 0.2, ratio[:17], 0.4, color=BLUE, label="Men and boys")
    ax.bar(x + 0.2, ratio[17:], 0.4, color=RED, label="Women and girls")
    ax.axhline(1, color="k", lw=0.8)
    ax.set_xticks(x, labels, rotation=45, ha="right")
    ax.set_ylabel("Identified dead ÷ expected\nif proportional to population")
    ax.set_title("H1. Deaths relative to each group's share of Gaza's population")
    ax.legend(frameon=False)
    fig.savefig(FIG / "h1-ratio.png")
    plt.close(fig)
    return obs, exp


# ---------------------------------------------------------------- H2, H3

def series():
    d = daily()
    dates = [iso(x["report_date"]) for x in d]
    total = np.array([x.get("ext_killed", 0) for x in d], float)
    new = []
    for x in d:
        if "killed_truce_new" in x:
            new.append(x["killed_truce_new"])
        elif "killed_recovered" in x or "killed_succumbed" in x:
            new.append(max(0, x.get("ext_killed", 0) - x.get("killed_recovered", 0) - x.get("killed_succumbed", 0)))
        else:
            new.append(x.get("ext_killed", 0))
    return dates, total, np.array(new, float)


def window(dates, a, b):
    return np.array([a <= t <= b for t in dates])


def ceasefire_test(tid, label, dates, total, new, pre, during, consistent):
    pre_m, dur_m = window(dates, *pre), window(dates, *during)
    sel = pre_m | dur_m
    # pre-registered: comparison window uses daily increments; ceasefire uses new killings
    y = np.where(dur_m, new, new if consistent else total)[sel]
    X = sm.add_constant(dur_m[sel].astype(float))
    res, alpha, p_over = nb_hac(y, X)
    rr = math.exp(res.params[1])
    lo, hi = np.exp(res.conf_int()[1])
    # weekly sensitivity
    idx = np.where(sel)[0]
    wk = defaultdict(lambda: [0.0, 0])
    for i in idx:
        key = ("d" if dur_m[i] else "p", (dates[i] - (during[0] if dur_m[i] else pre[0])).days // 7)
        wk[key][0] += (new[i] if dur_m[i] or consistent else total[i])
        wk[key][1] += 1
    wy = np.array([v[0] for k, v in wk.items() if v[1] == 7])
    wx = np.array([1.0 if k[0] == "d" else 0.0 for k, v in wk.items() if v[1] == 7])
    wres = sm.GLM(wy, sm.add_constant(wx), family=sm.families.NegativeBinomial(alpha=max(nb_alpha(wy, sm.add_constant(wx))[0], 1e-6))).fit()
    days_d = int(dur_m.sum())
    killed_d = float(new[dur_m].sum())
    rlo, rhi = stats.chi2.ppf(0.025, 2 * killed_d) / 2 / days_d, stats.chi2.ppf(0.975, 2 * killed_d + 2) / 2 / days_d
    return dict(rr=rr, ci=ci(lo, hi), p=float(res.pvalues[1]), alpha=alpha, p_over=p_over,
                pre_rate=float(y[X[:, 1] == 0].mean()), dur_rate=killed_d / days_d, dur_ci=ci(rlo, rhi),
                dur_days=days_d, dur_killed=int(killed_d),
                weekly_rr=float(math.exp(wres.params[1])), weekly_ci=ci(*np.exp(wres.conf_int()[1])), weekly_p=float(wres.pvalues[1]))


# Killings in Gaza during the pause of 24-30 November 2023. The Ministry of Health had
# stopped reporting on 11 November and the Government Media Office issued no total
# during the pause, so the daily series records zero for every day of it. These are the
# killings reported incident by incident; bodies recovered from the rubble on 27 and 28
# November (160) are deaths from before the pause and are excluded, as for H2b and H2c.
PAUSE = [
    ("2023-11-24", 2, "Two people shot dead returning north (AP, Al Jazeera, Gaza Ministry of Health; OCHA: at least one)"),
    ("2023-11-25", 0, None),
    ("2023-11-26", 1, "One man killed by tank fire east of Al-Maghazi (OCHA Flash Update #51)"),
    ("2023-11-27", 0, None),
    ("2023-11-28", 0, None),
    ("2023-11-29", 2, "Two people killed by Israeli fire in northern Gaza City (OCHA Flash Update #55)"),
    ("2023-11-30", 0, None),
]
PAUSE_UPPER = 40  # GMO total 14,800 (23 Nov) to more than 15,000 (28 Nov), less 160 recovered bodies
PAUSE_SOURCES = [
    {"title": "Hostilities in the Gaza Strip and Israel - Flash Update #49", "org": "OCHA", "date": "24 November 2023", "url": "https://www.ochaopt.org/content/hostilities-gaza-strip-and-israel-flash-update-49"},
    {"title": "Hostilities in the Gaza Strip and Israel - Flash Update #51", "org": "OCHA", "date": "26 November 2023", "url": "https://www.ochaopt.org/content/hostilities-gaza-strip-and-israel-flash-update-51"},
    {"title": "Hostilities in the Gaza Strip and Israel - Flash Update #53", "org": "OCHA", "date": "28 November 2023", "url": "https://www.ochaopt.org/content/hostilities-gaza-strip-and-israel-flash-update-53"},
    {"title": "Hostilities in the Gaza Strip and Israel - Flash Update #55", "org": "OCHA", "date": "30 November 2023", "url": "https://www.ochaopt.org/content/hostilities-gaza-strip-and-israel-flash-update-55"},
    {"title": "Israeli troops fire at Palestinians attempting to return to northern Gaza during cease-fire", "org": "Associated Press (PBS NewsHour)", "date": "24 November 2023", "url": "https://www.pbs.org/newshour/world/israeli-troops-fire-at-palestinians-attempting-to-return-to-northern-gaza-during-cease-fire"},
    {"title": "'The war is not over': Israel blocks Palestinians' return to northern Gaza", "org": "Al Jazeera", "date": "24 November 2023", "url": "https://www.aljazeera.com/news/2023/11/24/displaced-people-attempt-to-return-home-across-gaza-as-truce-sets-in"},
]


def h2a(dates, total):
    pre = (iso("2023-11-10"), iso("2023-11-23"))
    m = window(dates, *pre)
    y0 = total[m]
    y1 = np.array([k for _, k, _ in PAUSE], float)
    y = np.concatenate([y0, y1])
    x = np.concatenate([np.zeros_like(y0), np.ones_like(y1)])
    res, alpha, p_over = nb_hac(y, sm.add_constant(x))
    rr = math.exp(res.params[1])
    lo, hi = np.exp(res.conf_int()[1])
    k1, t1, k0, t0 = y1.sum(), len(y1), y0.sum(), len(y0)
    rre, ce, pe = rate_ratio_exact(k1, t1, k0, t0)
    rru, cu, pu = rate_ratio_exact(PAUSE_UPPER, t1, k0, t0)
    rlo, rhi = stats.chi2.ppf(0.025, 2 * k1) / 2 / t1, stats.chi2.ppf(0.975, 2 * k1 + 2) / 2 / t1
    DEPARTURES.append({"test": "H2a", "text": "The Ministry of Health daily series cannot be used for the pause: the Ministry had stopped reporting on 11 November, the Government Media Office issued no total during the pause, and the series records zero for every day of it, which are missing reports and not days without deaths. As directed by the editor, the pause-period count was reconstructed from the killings reported incident by incident in OCHA's flash updates and by the Associated Press and Al Jazeera (five deaths in seven days, a lower bound, since OCHA also reports shootings with 'several casualties' it does not break down). The comparison window is the 14 days before the pause, from the daily series. Because the two windows are measured differently, the test is repeated against an upper bound of 40 deaths, the rise in the Government Media Office total during the pause less the 160 bodies recovered from the rubble."})
    record(id="H2a", group="H2", title="The November 2023 pause and the daily killing rate",
           null="The daily rate of killing during the pause of 24-30 November 2023 equalled the rate in the 14 days before it.",
           data="Comparison window: Ministry of Health / Government Media Office daily series (Tech For Palestine), 10-23 November 2023. Pause: killings reported incident by incident (OCHA Flash Updates #49-#55; AP; Al Jazeera).",
           test=("Negative binomial" if alpha else "Poisson") + " regression on a pause indicator, Newey-West errors (lag 7)",
           statistic={"overdispersion_alpha": round(alpha, 3), "overdispersion_p": p_over},
           p=float(res.pvalues[1]), effect={"name": "Rate ratio, pause against the 14 days before", "value": round(rr, 4), "ci": ci(lo, hi)},
           descriptive={"before_per_day": round(float(y0.mean()), 1), "during_per_day": round(k1 / t1, 2),
                        "during_ci": [round(rlo, 2), round(rhi, 2)], "during_days": int(t1), "during_killed": int(k1),
                        "incidents": [{"date": d, "killed": k, "note": n} for d, k, n in PAUSE if k]},
           sensitivity=[{"name": "Exact conditional Poisson test", "value": round(rre, 4), "ci": ce, "p": pe},
                        {"name": f"Against the upper bound of {PAUSE_UPPER} deaths during the pause", "value": round(rru, 4), "ci": cu, "p": pu}],
           sources=PAUSE_SOURCES, ref="§13")


def h2(dates, total, new):
    h2a(dates, total)
    periods = [
        ("H2b", "The January-March 2025 ceasefire", (iso("2024-11-20"), iso("2025-01-18")), (iso("2025-01-19"), iso("2025-03-17"))),
        ("H2c", "The October 2025 ceasefire", (iso("2025-08-11"), iso("2025-10-09")), (iso("2025-10-10"), iso("2026-10-01"))),
    ]
    out = {}
    for tid, label, pre, during in periods:
        r = ceasefire_test(tid, label, dates, total, new, pre, during, consistent=False)
        s = ceasefire_test(tid, label, dates, total, new, pre, during, consistent=True)
        out[tid] = (pre, during)
        record(id=tid, group="H2", title=f"{label} and the daily killing rate",
               null=f"The daily rate of new killings during the ceasefire ({during[0]:%d %b %Y} to {during[1]:%d %b %Y}) equalled the rate in the 60 days before it.",
               data="Ministry of Health daily series (Tech For Palestine). Ceasefire days count new killings only where the Ministry separates them from bodies recovered.",
               test=("Negative binomial" if r["alpha"] else "Poisson") + " regression on a ceasefire indicator, Newey-West errors (lag 7)",
               statistic={"overdispersion_alpha": round(r["alpha"], 3), "overdispersion_p": r["p_over"]},
               p=r["p"], effect={"name": "Rate ratio, ceasefire against the 60 days before", "value": round(r["rr"], 3), "ci": ci(*r["ci"])},
               descriptive={"before_per_day": round(r["pre_rate"], 1), "during_per_day": round(r["dur_rate"], 2),
                            "during_ci": [round(v, 2) for v in r["dur_ci"]], "during_days": r["dur_days"], "during_killed": r["dur_killed"]},
               sensitivity=[{"name": "Weekly totals", "value": round(r["weekly_rr"], 3), "ci": ci(*r["weekly_ci"]), "p": r["weekly_p"]},
                            {"name": "New killings only in both windows", "value": round(s["rr"], 3), "ci": ci(*s["ci"]), "p": s["p"]}],
               ref="§13")

    ceasefire = np.zeros(len(dates), bool)
    for _, (pre, during) in out.items():
        ceasefire |= window(dates, *during)
    pause = {d: k for d, k, _ in PAUSE}
    SERIES["h2"] = {
        "dates": [d.isoformat() for d in dates],
        "total": [int(v) for v in total],
        "new": [int(pause[d.isoformat()]) if d.isoformat() in pause else int(new[i]) if ceasefire[i] else None
                for i, d in enumerate(dates)],
        "periods": [{"label": "November 2023 pause", "from": "2023-11-24", "to": "2023-11-30"}]
                   + [{"label": lab, "from": during[0].isoformat(), "to": during[1].isoformat()}
                      for lab, (_, during) in zip(["January-March 2025 ceasefire", "October 2025 ceasefire"], out.values())],
    }
    fig, ax = plt.subplots(figsize=(7.2, 2.8))
    ax.plot(dates, total, color=GREY, lw=0.6, label="Daily increase in the reported total")
    ax.set_yscale("symlog", linthresh=10)
    for tid, (pre, during) in out.items():
        ax.axvspan(during[0], during[1], color=GREEN, alpha=0.15, lw=0)
        m = window(dates, *during)
        ax.plot(np.array(dates)[m], new[m], color=GREEN, lw=0.7)
    ax.axvspan(iso("2023-11-24"), iso("2023-11-30"), color=GREEN, alpha=0.15, lw=0)
    ax.plot([iso(d) for d, _, _ in PAUSE], [k for _, k, _ in PAUSE], color=GREEN, lw=0.7)
    ax.plot([], [], color=GREEN, label="New killings, ceasefire periods")
    ax.set_ylabel("Deaths per day (log scale)")
    ax.set_title("H2. Daily deaths in Gaza and the ceasefire periods (shaded)")
    ax.legend(frameon=False, loc="upper center", bbox_to_anchor=(0.5, -0.12), ncol=2)
    fig.savefig(FIG / "h2-ceasefires.png")
    plt.close(fig)


def h3(dates, total):
    a, b = iso("2023-12-01"), iso("2024-07-31")
    m = window(dates, a, b)
    d = np.array(dates)[m]
    y = total[m]
    t = np.array([(x - a).days for x in d], float)
    orders = [("H3a", iso("2024-01-26")), ("H3b", iso("2024-03-28")), ("H3c", iso("2024-05-24"))]
    cols = [np.ones_like(t), t]
    for _, T in orders:
        k = (T - a).days
        step = (t >= k).astype(float)
        cols += [step, step * (t - k)]
    X = np.column_stack(cols)
    res, alpha, p_over = nb_hac(y, X)
    for j, (tid, T) in enumerate(orders):
        li, si = 2 + 2 * j, 3 + 2 * j
        R = np.zeros((2, X.shape[1]))
        R[0, li] = R[1, si] = 1
        w = res.wald_test(R, scalar=True)
        rr = math.exp(res.params[li])
        lo, hi = np.exp(res.conf_int()[li])
        record(id=tid, group="H3", title=f"The ICJ order of {T:%d %B %Y} and the daily killing rate",
               null=f"No change in the level or the slope of daily deaths at the order of {T:%d %B %Y}.",
               data="Ministry of Health daily series (Tech For Palestine), 1 December 2023 to 31 July 2024.",
               test="Segmented negative binomial regression (trend, and a level and slope change at each order), Newey-West errors; joint Wald test of level and slope",
               statistic={"wald_chi2": round(float(w.statistic), 2), "df": 2, "overdispersion_alpha": round(alpha, 3)},
               p=float(w.pvalue), effect={"name": "Rate ratio, level change at the order", "value": round(rr, 3), "ci": ci(lo, hi),
                                          "slope_change_per_30_days": round(math.exp(30 * res.params[si]), 3)},
               ref="§13")
    SERIES["h3"] = {"dates": [x.isoformat() for x in d], "observed": [int(v) for v in y],
                    "fitted": [round(float(v), 1) for v in res.fittedvalues],
                    "orders": [{"id": tid, "date": T.isoformat()} for tid, T in orders]}
    fig, ax = plt.subplots(figsize=(7.2, 2.8))
    ax.plot(d, y, color=GREY, lw=0.6, label="Daily deaths")
    ax.plot(d, res.fittedvalues, color=BLUE, lw=1.4, label="Segmented model")
    for _, T in orders:
        ax.axvline(T, color=RED, lw=0.8, ls="--")
    ax.set_ylim(0, np.percentile(y, 99))
    ax.set_title("H3. Daily deaths and the three ICJ provisional measures orders (dashed)")
    ax.legend(frameon=False)
    fig.savefig(FIG / "h3-icj.png")
    plt.close(fig)


# ---------------------------------------------------------------- H4

def rate_ratio_exact(k1, t1, k0, t0):
    """Exact conditional test of two Poisson rates; rate ratio (1 over 0) with exact interval."""
    n = k1 + k0
    p0 = t1 / (t1 + t0)
    bt = stats.binomtest(int(k1), int(n), p0)
    lo, hi = bt.proportion_ci(method="exact")
    conv = lambda q: (q / (1 - q)) * (t0 / t1)
    return (k1 / t1) / (k0 / t0), ci(conv(lo), conv(hi)), float(bt.pvalue)


def h4():
    h = json.loads((DATA / "history.json").read_text())
    seg = h["before_after"]["segments"]
    k0, t0, k1, t1 = seg[0]["killed"], seg[0]["days"], seg[1]["killed"], seg[1]["days"]
    rr, c, p = rate_ratio_exact(k1, t1, k0, t0)
    record(id="H4a", group="H4", title="West Bank killings before and after 7 October 2023",
           null="The daily rate of Palestinians killed in the West Bank was the same after 7 October 2023 as before it, within 2023.",
           data=f"OCHA via the report: {k0} killed in {t0} days (1 January-6 October 2023); {k1} in {t1} days (7 October-31 December 2023).",
           test="Exact conditional test of two Poisson rates", statistic={"before_per_day": round(k0 / t0, 2), "after_per_day": round(k1 / t1, 2)},
           p=p, effect={"name": "Rate ratio, after against before", "value": round(rr, 2), "ci": c}, ref="§11")
    sv = {y["year"]: y["per_day"] for y in h["settler_violence"]["years"]}
    rr, c, p = rate_ratio_exact(sv[2024] * 365, 365, sv[2022] * 365, 365)
    rrb, cb, pb = rate_ratio_exact(round(6.5 * 365), 365, round(2.5 * 365), 365)
    record(id="H4b", group="H4", title="Settler incidents against Palestinians, 2024 against 2022",
           null="The rate of settler incidents against Palestinians was the same in 2024 as in 2022.",
           data=f"OCHA daily averages via the report: {sv[2022]} a day in 2022, {sv[2024]} a day in 2024.",
           test="Exact conditional test of two Poisson rates on annual counts reconstructed from the daily averages",
           statistic={"2022_per_day": sv[2022], "2024_per_day": sv[2024]},
           p=p, effect={"name": "Rate ratio, 2024 against 2022", "value": round(rr, 2), "ci": c},
           sensitivity=[{"name": "At the rounding bounds least favourable to rejection (2.5 and 6.5 a day)", "value": round(rrb, 2), "ci": cb, "p": pb}],
           ref="§11")


# ---------------------------------------------------------------- H5

def h5():
    d = daily()
    # The child total is published only on some days and carried forward between them,
    # so calendar-month differences read a missing breakdown as a month with no children
    # killed. Each observation is instead the interval between two published child totals.
    rep = []
    for x in d:
        if "killed_children_cum" in x and (not rep or x["killed_children_cum"] != rep[-1][2]):
            rep.append((iso(x["report_date"]), x["ext_killed_cum"], x["killed_children_cum"]))  # a new figure, not a repeat
    rows, bad = [], []
    for (d0, k0, c0), (d1, k1, c1) in zip(rep, rep[1:]):
        k, c = k1 - k0, c1 - c0
        if k <= 0 or c < 0 or c > k:
            bad.append(f"{d0}..{d1}")
            continue
        rows.append((d0, d1, k, c))
    DEPARTURES.append({"test": "H5", "text": "The pre-registered monthly differences cannot be used: the Ministry publishes its child total on some days only (133 of 1,091, fewer once repeats of an unchanged figure are set aside), three times after December 2024, and the series carries it forward between them, so a calendar month with no new breakdown reads as a month in which no children were killed. Each observation is instead the interval between two consecutive published child totals, with the deaths and child deaths in that interval, placed at its midpoint. " + (f"{len(bad)} interval(s) in which the child total fell or rose by more than the total are revisions and are excluded." if bad else "No interval needed excluding.")})
    origin = iso("2023-10-07")
    mid = np.array([((a - origin).days + (b - origin).days) / 2 / 30.44 for a, b, _, _ in rows])
    succ = np.array([c for *_, c in rows], float)
    fail = np.array([k - c for _, _, k, c in rows], float)
    n_ = succ + fail
    Y = succ / n_
    res = sm.GLM(Y, sm.add_constant(mid), family=sm.families.Binomial(), var_weights=n_).fit(scale="X2")
    orr = math.exp(12 * res.params[1])
    lo, hi = np.exp(12 * res.conf_int()[1])
    brk = np.array([a >= iso("2024-05-01") for a, *_ in rows], float)
    res2 = sm.GLM(Y, np.column_stack([np.ones_like(mid), mid, brk]), family=sm.families.Binomial(), var_weights=n_).fit(scale="X2")
    early = np.array([b_ <= iso("2024-11-30") for _, b_, _, _ in rows])
    res3 = sm.GLM(Y[early], sm.add_constant(mid[early]), family=sm.families.Binomial(), var_weights=n_[early]).fit(scale="X2")
    shares = succ / (succ + fail)
    record(id="H5", group="H5", title="The share of children among the dead over time",
           null="The share of children among those killed in Gaza did not change over time.",
           data=f"Ministry of Health cumulative totals on the {len(rep)} days a new child total was published (Tech For Palestine), {rep[0][0]:%d %b %Y} to {rep[-1][0]:%d %b %Y}; {len(rows)} intervals.",
           test="Quasi-binomial regression of the child share in each interval on time (interval midpoint), weighted by deaths",
           statistic={"dispersion": round(float(res.scale), 1), "intervals": len(rows)},
           p=float(res.pvalues[1]), effect={"name": "Odds ratio per year", "value": round(orr, 3), "ci": ci(lo, hi)},
           sensitivity=[{"name": "With a break at May 2024", "value": round(math.exp(12 * res2.params[1]), 3),
                         "ci": ci(*np.exp(12 * res2.conf_int()[1])), "p": float(res2.pvalues[1]),
                         "break_odds_ratio": round(math.exp(res2.params[2]), 3), "break_p": float(res2.pvalues[2])},
                        {"name": "Intervals ending by 30 November 2024 only, before the child total was updated rarely", "value": round(math.exp(12 * res3.params[1]), 3),
                         "ci": ci(*np.exp(12 * res3.conf_int()[1])), "p": float(res3.pvalues[1])}],
           series=[{"from": a.isoformat(), "to": b.isoformat(), "killed": int(k), "children": int(c), "share": round(c / k, 4), "fit": round(float(f), 4)}
                   for (a, b, k, c), f in zip(rows, res.fittedvalues)],
           ref="§6.1")
    fig, ax = plt.subplots(figsize=(7.2, 2.6))
    x = [a + (b - a) / 2 for a, b, _, _ in rows]
    ax.scatter(x, shares, s=np.clip((succ + fail) / 40, 4, 120), color=RED, alpha=0.7, label="Child share in each interval (area ∝ deaths)")
    ax.plot(x, res.fittedvalues, color=BLUE, lw=1.2, label="Fitted trend")
    ax.set_ylabel("Share of the dead\nwho were children")
    ax.set_ylim(0, 1)
    ax.set_title("H5. Children as a share of deaths between published child totals")
    ax.legend(frameon=False)
    fig.savefig(FIG / "h5-children.png")
    plt.close(fig)


# ---------------------------------------------------------------- H6

def id_valid(s):
    s = str(s).zfill(9)
    if not s.isdigit() or len(s) != 9:
        return False
    tot = 0
    for i, ch in enumerate(s):
        v = int(ch) * (1 if i % 2 == 0 else 2)
        tot += v - 9 if v > 9 else v
    return tot % 10 == 0


def whipple(ages):
    c = Counter(ages)
    num = sum(c[a] for a in range(25, 61, 5))
    den = sum(c[a] for a in range(23, 63)) / 5
    return 100 * num / den


def myers(ages, lo=10, hi=89):
    c = Counter(ages)
    blended = []
    for d in range(10):
        a = sum(c[x] for x in range(lo + d, hi + 1, 10))
        b = sum(c[x] for x in range(lo + 10 + d, hi + 1, 10))
        blended.append(a * (d + 1) + b * (9 - d))
    tot = sum(blended)
    return 0.5 * sum(abs(100 * v / tot - 10) for v in blended), [round(100 * v / tot, 2) for v in blended]


def h6(people):
    n = len(people)
    ok = sum(id_valid(p["id"]) for p in people)
    lo, hi = proportion_confint(ok, n, method="wilson")
    p = stats.binomtest(ok, n, 0.1, alternative="greater").pvalue
    dup_ids = sum(v - 1 for v in Counter(p["id"] for p in people).values() if v > 1)
    dup_name_dob = sum(v - 1 for v in Counter((p["name"], p.get("dob")) for p in people).values() if v > 1)
    start, end = iso("2023-10-07"), iso("2026-10-01")

    def years(b, at):
        return at.year - b.year - ((at.month, at.day) < (b.month, b.day))
    mismatch = 0
    checked = 0
    for x in people:
        if not x.get("dob"):
            continue
        try:
            b = iso(x["dob"])
        except ValueError:
            continue
        checked += 1
        if not (years(b, start) - 1 <= int(x["age"]) <= years(b, end) + 1):
            mismatch += 1
    record(id="H6a", group="H6", title="The identity numbers on the named list",
           null="The identity numbers are valid Population Registry numbers (pass the check digit).",
           data=f"Ministry of Health named list, {n:,} records.",
           test="Share passing the check digit, with its interval; exact binomial test against the 10% expected of fabricated numbers; decision rule: validity rejected if under 99% pass",
           statistic={"valid": ok, "n": n},
           p=float(p), effect={"name": "Share of identity numbers with a valid check digit", "value": round(ok / n, 5), "ci": ci(lo, hi)},
           decision="validity not rejected" if ok / n >= 0.99 else "validity rejected",
           descriptive={"duplicate_ids": dup_ids, "duplicate_name_and_dob": dup_name_dob,
                        "age_dob_checked": checked, "age_dob_disagree": mismatch},
           ref="§6.1")
    ages = [int(p["age"]) for p in people]
    w = whipple(ages)
    my, digits = myers(ages)
    scale = "highly accurate" if w < 105 else "fairly accurate" if w < 110 else "approximate" if w < 125 else "rough" if w < 175 else "very rough"
    record(id="H6b", group="H6", title="Age heaping on the named list",
           null="Age reporting shows no more heaping on ages ending in 0 and 5 than a registry-based list would.",
           data="As H6a.", test="Whipple's index (ages 23-62) on the UN scale, and Myers' blended index (ages 10-89), against the PCBS 2017 census",
           statistic={"whipple": round(w, 1), "myers": round(my, 2)},
           p=None, effect={"name": "Whipple's index", "value": round(w, 1), "scale": scale,
                           "census_whipple": 100.0, "census_myers": 2.4},
           digits=digits, ages=[Counter(ages)[a] for a in range(0, 101)], ref="§6.1")
    fig, ax = plt.subplots(figsize=(7.2, 2.6))
    c = Counter(ages)
    xs = list(range(0, 91))
    ax.bar(xs, [c[a] for a in xs], color=[RED if a % 5 == 0 else GREY for a in xs], width=0.85)
    ax.set_xlabel("Age (ages ending in 0 or 5 in red)")
    ax.set_ylabel("Identified dead")
    ax.set_title(f"H6. Single-year ages on the named list: Whipple {w:.1f}, Myers {my:.2f}")
    fig.savefig(FIG / "h6-ages.png")
    plt.close(fig)


# ---------------------------------------------------------------- H7

def walk_items(debate):
    yield from debate.get("Items", [])
    for child in debate.get("ChildDebates", []):
        yield from walk_items(child)


def h7():
    # The Hansard debates are 10 MB of raw text that stay on the workstation (they are
    # not in the site repository), so the counts the test needs are saved beside the
    # other external data by the full run and read back when the debates are absent,
    # which is how the nightly refresh runs it. H7 is not one of the published tests;
    # it is computed so that the false discovery rate is controlled across all of them.
    snapshot = HERE / "external" / "h7-counts.json"
    files = sorted(glob.glob(str(RAW / "hansard" / "*.json")))
    if files:
        con = json.loads((DATA / "constituency.json").read_text())
        party = {m["id"]: m["party"] for m in con["members"]}
        spoke, used = set(), set()
        for f in files:
            deb = json.loads(pathlib.Path(f).read_text())
            for it in walk_items(deb):
                mid = it.get("MemberId")
                if it.get("ItemType") != "Contribution" or mid not in party:
                    continue
                spoke.add(mid)
                if re.search(r"genocid", html.unescape(re.sub(r"<[^>]+>", " ", it.get("Value") or "")), re.I):
                    used.add(mid)
        by = defaultdict(lambda: [0, 0])
        for mid in spoke:
            by[party[mid]][0] += 1
            by[party[mid]][1] += mid in used
        if not SITE_ONLY:
            snapshot.write_text(json.dumps({"files": len(files), "spoke": len(spoke), "by_party": by}, indent=1))
        n_files, n_spoke = len(files), len(spoke)
    else:
        saved = json.loads(snapshot.read_text())
        by = defaultdict(lambda: [0, 0], {k: list(v) for k, v in saved["by_party"].items()})
        n_files, n_spoke = saved["files"], saved["spoke"]
    big = {k: v for k, v in by.items() if v[0] >= 10}
    other = [sum(v[0] for k, v in by.items() if k not in big), sum(v[1] for k, v in by.items() if k not in big)]
    rows = sorted(big.items(), key=lambda kv: -kv[1][0]) + ([("Other parties and independents", other)] if other[0] else [])
    table = np.array([[v[1], v[0] - v[1]] for _, v in rows])
    chi2, p, dof, _ = stats.chi2_contingency(table)
    v = math.sqrt(chi2 / table.sum())
    lab, con_ = by.get("Labour"), by.get("Conservative")
    odds, pf = stats.fisher_exact([[lab[1], lab[0] - lab[1]], [con_[1], con_[0] - con_[1]]])
    record(id="H7", group="H7", title='Party and the word "genocide" in Commons debates on Gaza',
           null="Among sitting members who spoke in these debates, use of the word is independent of party.",
           data=f"Full Hansard text of {n_files} Commons and Westminster Hall debates since 7 October 2023; {n_spoke} sitting members spoke.",
           test="Chi-square test of independence across parties with at least 10 speakers, others pooled; Fisher's exact test, Labour against Conservative",
           statistic={"chi2": round(chi2, 1), "df": int(dof), "fisher_odds_ratio_lab_con": round(odds, 2) if math.isfinite(odds) else None, "fisher_p": float(pf)},
           p=float(p), effect={"name": "Cramér's V", "value": round(v, 3)},
           parties=[{"party": k, "speakers": int(v_[0]), "used": int(v_[1]), "share": round(v_[1] / v_[0], 3)} for k, v_ in rows],
           ref="§13.3A")
    fig, ax = plt.subplots(figsize=(6.4, 2.6))
    names = [k for k, _ in rows]
    shares = [v[1] / v[0] for _, v in rows]
    ax.barh(names[::-1], shares[::-1], color=BLUE)
    for i, (_, v_) in enumerate(rows[::-1]):
        ax.text(v_[1] / v_[0] + 0.01, i, f"{v_[1]} of {v_[0]}", va="center", fontsize=8)
    ax.set_xlim(0, 0.6)
    ax.set_xlabel('Share of speaking members who used the word')
    ax.set_title("H7. The word genocide in Commons debates, by party")
    fig.savefig(FIG / "h7-party.png")
    plt.close(fig)


# ---------------------------------------------------------------- H8

def h8():
    w = json.loads((DATA / "world-positions.json").read_text())
    un = {s["map"]: s["recognises"] for s in w["recognition"]["states"] if s.get("un")}
    sanc = {c["map"] for m in w["sanctions"]["measures"] for c in m["countries"]}
    says = {s["map"] for s in w["genocide"]["states"] if s.get("un") and s.get("position") == "says" and s.get("map")}
    missing = sorted((sanc | says) - set(un))
    if missing:
        DEPARTURES.append({"test": "H8", "text": "States named in the sanctions or genocide lists that do not join to a UN member in the recognition list: " + ", ".join(missing) + "."})
    for tid, title, group, label in [
        ("H8a", "Recognition of Palestine and sanctions", sanc, "imposes a recorded sanction"),
        ("H8b", "Recognition of Palestine and calling it genocide", says, "government has called it genocide"),
    ]:
        a = sum(1 for k, r in un.items() if r and k in group)
        b = sum(1 for k, r in un.items() if r and k not in group)
        c = sum(1 for k, r in un.items() if not r and k in group)
        d = sum(1 for k, r in un.items() if not r and k not in group)
        odds, p = stats.fisher_exact([[a, b], [c, d]])
        t2 = sm.stats.Table2x2(np.array([[a, b], [c, d]]) + (0.5 if 0 in (a, b, c, d) else 0))
        lo, hi = t2.oddsratio_confint()
        record(id=tid, group="H8", title=title,
               null=f"Whether a UN member state {label} is independent of whether it recognises Palestine.",
               data=f"World positions dataset, {len(un)} UN member states.",
               test="Fisher's exact test" + (" (interval with Haldane correction for a zero cell)" if 0 in (a, b, c, d) else ""),
               statistic={"recognises_and_yes": a, "recognises_and_no": b, "does_not_and_yes": c, "does_not_and_no": d},
               p=float(p), effect={"name": "Odds ratio", "value": round(float(t2.oddsratio), 2) if math.isfinite(t2.oddsratio) else None, "ci": ci(lo, hi)},
               ref="§15.4")


# ---------------------------------------------------------------- H9-H16: external datasets

EXT = HERE / "external"


def ext():
    return json.loads((EXT / "figures.json").read_text())


def two_props(a, n1, b, n2):
    """Fisher's exact test of two proportions, with the odds ratio and its interval."""
    tab = np.array([[a, n1 - a], [b, n2 - b]], float)
    _, p = stats.fisher_exact(tab.astype(int))
    t2 = sm.stats.Table2x2(tab + (0.5 if (tab == 0).any() else 0))
    lo, hi = t2.oddsratio_confint()
    return float(t2.oddsratio), ci(lo, hi), float(p)


def h9():
    F = ext()
    y, mc = F["yesh_din"], F["military_courts"]
    concluded = round(y["indictments"] / y["indictment_share_of_concluded"])
    conv, ind = y["convictions_full_or_partial"], y["indictments"]
    convicted_pal = mc["cases"] - mc["full_acquittals"]
    orr, c, p = two_props(conv, ind, convicted_pal, mc["cases"])
    lo, hi = proportion_confint(conv, ind, method="wilson")
    lo2, hi2 = proportion_confint(ind, concluded, method="wilson")
    record(id="H9a", group="H9", title="Settlers and Palestinians before Israeli courts in the West Bank",
           null="An Israeli indicted for an offence against Palestinians in the West Bank is as likely to be convicted as a Palestinian tried in the military courts.",
           data=f"Yesh Din, {y['files_monitored']:,} police files on offences by Israelis against Palestinians, 2005-2024 ({ind} indictments, {conv} full or partial convictions); Israeli military courts' 2010 annual report as reported by Haaretz ({mc['cases']:,} cases, {mc['full_acquittals']} full acquittals).",
           test="Fisher's exact test of two proportions",
           statistic={"settler_convicted": conv, "settler_indicted": ind, "palestinian_convicted": convicted_pal, "palestinian_cases": mc["cases"],
                      "indicted_share_of_concluded": round(ind / concluded, 4), "indicted_ci": ci(lo2, hi2)},
           p=p, effect={"name": "Odds ratio, settler conviction against Palestinian conviction", "value": round(orr, 4), "ci": c},
           descriptive={"settler_conviction_rate": round(conv / ind, 3), "settler_ci": ci(lo, hi),
                        "palestinian_conviction_rate": round(convicted_pal / mc["cases"], 4),
                        "files_ending_in_conviction": round(conv / y["files_monitored"], 3)},
           sources=[{"title": "Data Sheet: Law Enforcement on Israeli Civilians in the West Bank, 2005-2024", "org": "Yesh Din", "date": "16 January 2025", "url": y["url"]},
                    {"title": "Nearly 100% of all military court cases in West Bank end in conviction", "org": "Haaretz", "date": "29 November 2011", "url": mc["url"]}],
           ref="§11")
    nf, n = y["complaints_not_filed_2024"]
    bt = stats.binomtest(nf, n, 0.5, alternative="greater")
    lo, hi = bt.proportion_ci(method="exact")
    record(id="H9b", group="H9", title="Palestinian victims of settler violence who do not complain to the police",
           null="No more than half of Palestinian victims of settler violence decline to file a police complaint.",
           data=f"Yesh Din, incidents it documented in 2024: in {nf} of {n} the victims chose not to complain.",
           test="Exact binomial test against one half (one-sided)",
           statistic={"not_filed": nf, "incidents": n},
           p=float(bt.pvalue), effect={"name": "Share of victims not filing a complaint", "value": round(nf / n, 3), "ci": ci(lo, hi)},
           ref="§11")


def h10():
    A = ext()["area_c"]
    pp = A["palestinian_permits_2016_2020"]
    bench = A["settler_plan_approval_share"][0]
    bt = stats.binomtest(pp["approved"], pp["applications"], bench, alternative="less")
    lo, hi = bt.proportion_ci(method="exact")
    record(id="H10a", group="H10", title="Building permits for Palestinians in Area C",
           null=f"Palestinian applications for building permits in Area C are approved at the rate settlers' plans are approved (at least {pct(bench, 0)}).",
           data=f"Civil Administration and Bimkom figures, 2016-2020: {pp['approved']} of {pp['applications']:,} Palestinian applications approved; the Civil Administration's own statement that 60-70% of settlement plans submitted are approved (Knesset, 19 July 2023).",
           test="Exact binomial test against the lower bound of the settler approval rate (one-sided)",
           statistic={"approved": pp["approved"], "applications": pp["applications"]},
           p=float(bt.pvalue), effect={"name": "Share of Palestinian applications approved", "value": round(pp["approved"] / pp["applications"], 4), "ci": ci(lo, hi), "benchmark": bench},
           sources=[{"title": "The Civil Administration acknowledges extreme discrimination in building permits and law enforcement between Palestinians and settlers", "org": "Peace Now", "date": "10 August 2023", "url": A["url"]}],
           ref="§12")
    e = A["enforcement_2022_to_mid_2023"]
    a, n1 = e["palestinian"]["demolished"], e["palestinian"]["identified_illegal"]
    b, n2 = e["settler"]["demolished"], e["settler"]["identified_illegal"]
    orr, c, p = two_props(a, n1, b, n2)
    record(id="H10b", group="H10", title="Demolition of unpermitted structures: Palestinian and settler",
           null="An unpermitted Palestinian structure in Area C is as likely to be demolished as an unpermitted settler structure.",
           data=f"Civil Administration figures, 2022 to mid-2023: {a} of {n1:,} Palestinian structures identified as unpermitted demolished, against {b} of {n2} settler structures.",
           test="Fisher's exact test of two proportions",
           statistic={"palestinian_demolished": a, "palestinian_identified": n1, "settler_demolished": b, "settler_identified": n2},
           p=p, effect={"name": "Odds ratio, Palestinian against settler", "value": round(orr, 2), "ci": c},
           descriptive={"palestinian_rate": round(a / n1, 3), "settler_rate": round(b / n2, 3)},
           ref="§12")


def prices():
    wb = openpyxl.load_workbook(EXT / "pcbs-prices.xlsx", read_only=True, data_only=True)
    rows = list(wb.worksheets[0].iter_rows(values_only=True))
    head = rows[1]
    cols = [(i, c.strftime("%Y-%m")) for i, c in enumerate(head) if isinstance(c, dt.datetime)]
    items = {}
    for r in rows[2:]:
        code = str(r[0] or "")
        if not code.startswith("01") or not isinstance(r[5], (int, float)) or r[5] <= 0:
            continue  # food and non-alcoholic beverages (COICOP 01) with a pre-war price
        vals = [r[i] for i, _ in cols]
        if all(isinstance(v, (int, float)) and v > 0 for v in vals):
            items[(r[3] or r[1]).strip()] = (r[5], vals)
    months = [m for _, m in cols]
    return months, items


def food_index(months, items):
    """Geometric mean of each food item's price against its pre-war price."""
    rel = np.array([[v / base for v in vals] for base, vals in items.values()])
    return np.exp(np.log(rel).mean(axis=0))


def price_window_test(months, items, before, after):
    rows = []
    for k, (base, vals) in enumerate(items.values()):
        for m, v in zip(months, vals):
            if m in before or m in after:
                rows.append((k, 1.0 if m in after else 0.0, math.log(v)))
    k_ = np.array([r[0] for r in rows]); x = np.array([r[1] for r in rows]); y = np.array([r[2] for r in rows])
    dummies = (k_[:, None] == np.arange(len(items))[None, :]).astype(float)
    X = np.column_stack([x, dummies])
    res = sm.OLS(y, X).fit(cov_type="cluster", cov_kwds={"groups": k_})
    return math.exp(res.params[0]), ci(*np.exp(res.conf_int()[0])), float(res.pvalues[0])


def h11():
    months, items = prices()
    idx = food_index(months, items)
    SERIES["h11"] = {"months": months, "index": [round(float(v), 3) for v in idx], "items": len(items)}
    windows = [
        ("H11a", "The total blockade of March to May 2025 and food prices in Gaza",
         ["2024-12", "2025-01", "2025-02"], ["2025-03", "2025-04", "2025-05"],
         "the total blockade (March-May 2025)", "the three months before (December 2024-February 2025)"),
        ("H11b", "The closure of the crossings in June 2026 and food prices in Gaza",
         ["2026-03", "2026-04", "2026-05"], ["2026-06", "2026-07", "2026-08"],
         "the three months after the crossings were closed (June-August 2026)", "the three months before (March-May 2026)"),
    ]
    for tid, title, before, after, la, lb in windows:
        r, c, p = price_window_test(months, items, set(before), set(after))
        record(id=tid, group="H11", title=title,
               null=f"Food prices in {la} were the same as in {lb}.",
               data=f"PCBS monthly prices in Gaza of {len(items)} food items with a complete series (COICOP division 01), November 2023 to August 2026.",
               test="Regression of log price on a period indicator with item fixed effects, errors clustered by item",
               statistic={"items": len(items)},
               p=p, effect={"name": "Price ratio, after against before", "value": round(r, 3), "ci": c},
               descriptive={"index_before": round(float(np.mean([idx[months.index(m)] for m in before])), 2),
                            "index_after": round(float(np.mean([idx[months.index(m)] for m in after])), 2)},
               sources=[{"title": "State of Palestine: Prices of Basic Commodities in Gaza", "org": "Palestinian Central Bureau of Statistics (HDX)", "date": "updated 13 September 2026",
                         "url": "https://data.humdata.org/dataset/state-of-palestine-price-of-basic-commodities-in-gaza"}],
               ref="§6.3")
    peak = int(np.argmax(idx))
    record(id="H11c", group="H11", title="Food prices in Gaza against their pre-war level",
           null="Food prices in Gaza during the war were at their pre-war level.",
           data=f"As H11a; each month's index is the geometric mean of the {len(items)} items' prices relative to their average before 7 October 2023.",
           test="One-sample t-test of the monthly log index against zero",
           statistic={"months": len(months), "months_above_prewar": int((idx > 1).sum())},
           p=float(stats.ttest_1samp(np.log(idx), 0).pvalue),
           effect={"name": "Mean price level against pre-war (geometric)", "value": round(float(np.exp(np.log(idx).mean())), 2),
                   "ci": ci(*np.exp(stats.t.interval(0.95, len(idx) - 1, loc=np.log(idx).mean(), scale=stats.sem(np.log(idx)))))},
           descriptive={"peak_month": months[peak], "peak_index": round(float(idx[peak]), 1)},
           ref="§6.3")


def h12():
    months, items = prices()
    idx = dict(zip(months, food_index(months, items)))
    wb = openpyxl.load_workbook(EXT / "unrwa-trucks.xlsx", read_only=True)
    trucks = Counter()
    it = wb.worksheets[0].iter_rows(values_only=True)
    next(it)
    for r in it:
        if r[2]:
            trucks[r[2].strftime("%Y-%m")] += r[1] or 0
    span = [m for m in sorted(trucks) if "2023-11" <= m <= "2024-12" and m in idx]  # whole months only
    x = np.log([trucks[m] for m in span]); y = np.log([idx[m] for m in span])
    res = sm.OLS(y, sm.add_constant(x)).fit(cov_type="HAC", cov_kwds={"maxlags": 2})
    lag = [m for m in span if m != span[0]]
    x1 = np.log([trucks[span[span.index(m) - 1]] for m in lag]); y1 = np.log([idx[m] for m in lag])
    r1 = sm.OLS(y1, sm.add_constant(x1)).fit(cov_type="HAC", cov_kwds={"maxlags": 2})
    rho, prho = stats.spearmanr([trucks[m] for m in span], [idx[m] for m in span])
    SERIES["h12"] = {"months": span, "trucks": [int(trucks[m]) for m in span], "index": [round(float(idx[m]), 3) for m in span]}
    record(id="H12", group="H12", title="Aid trucks entering Gaza and food prices",
           null="Food prices in Gaza do not vary with the number of aid trucks entering.",
           data=f"UNRWA supply tracking of trucks entering Gaza (HDX), {span[0]} to {span[-1]}, {len(span)} whole months; PCBS food price index as H11.",
           test="Regression of the log food price index on log monthly trucks, Newey-West errors (lag 2)",
           statistic={"months": len(span), "spearman_rho": round(float(rho), 3), "spearman_p": float(prho)},
           p=float(res.pvalues[1]), effect={"name": "Elasticity: % change in food prices per 1% more trucks", "value": round(float(res.params[1]), 3), "ci": ci(*res.conf_int()[1])},
           sensitivity=[{"name": "Trucks in the previous month", "value": round(float(r1.params[1]), 3), "ci": ci(*r1.conf_int()[1]), "p": float(r1.pvalues[1])}],
           sources=[{"title": "State of Palestine: Gaza Supplies and Dispatch Tracking", "org": "UNRWA (HDX)", "date": "21 October 2023 to 16 January 2025",
                     "url": "https://data.humdata.org/dataset/state-of-palestine-gaza-aid-truck-data"}],
           ref="§6.3")


def h13():
    D_ = ext()["detention"]
    a = D_["administrative_detainees"]
    years = sorted(a)
    y = np.array([a[k] for k in years], float)
    post = np.array([int(k) >= 2023 for k in years], float)
    res, alpha, p_over = nb_hac(y, sm.add_constant(post), lags=1)
    rr = math.exp(res.params[1]); lo, hi = np.exp(res.conf_int()[1])
    pre_max = max(a[k] for k in years if int(k) < 2023)
    SERIES["h13"] = {"years": years, "admin": [a[k] for k in years], "combatants": [D_["illegal_combatants"].get(k, 0) for k in years]}
    record(id="H13", group="H13", title="Administrative detention, without charge or trial, before and after 7 October 2023",
           null="The number of Palestinians held in administrative detention was the same after October 2023 as in 2008-2022.",
           data=f"Israel Prison Service figures compiled by B'Tselem, end of each year 2008-2025 and 30 June 2026.",
           test="Negative binomial regression of the yearly count on a post-October-2023 indicator, Newey-West errors (lag 1)",
           statistic={"overdispersion_alpha": round(alpha, 3), "pre_war_mean": round(float(y[post == 0].mean())), "post_mean": round(float(y[post == 1].mean())), "pre_war_max": pre_max},
           p=float(res.pvalues[1]), effect={"name": "Ratio, after against 2008-2022", "value": round(rr, 2), "ci": ci(lo, hi)},
           sources=[{"title": "Statistics on Palestinians in Israeli custody", "org": "B'Tselem", "date": "June 2026", "url": D_["url"]}],
           ref="§11")


def h14():
    J = ext()["journalists"]
    c = J["conflicts"]
    yrs = [(iso(x["to"]) - iso(x["from"])).days / 365.25 for x in c]
    g = c[0]
    rows = []
    for x, t in zip(c[1:], yrs[1:]):
        rr, ci_, p = rate_ratio_exact(g["killed"], yrs[0], x["killed"], t)
        rows.append((x["name"], rr, ci_, p, x["killed"] / t))
    SERIES["h14"] = [{"name": x["name"], "killed": x["killed"], "years": round(t, 2), "per_year": round(x["killed"] / t, 1)} for x, t in zip(c, yrs)]
    for (name, rr, ci_, p, rate), tid in zip(rows, ["H14a", "H14b"]):
        record(id=tid, group="H14", title=f"Journalists killed a year: the Gaza war against the {name}",
               null=f"Journalists were killed at the same rate in the Gaza war as in the {name}.",
               data=f"Committee to Protect Journalists: {g['killed']} journalists killed by Israel in the Gaza war to 30 June 2026 (CPJ's count after its June 2026 review, the lowest it has published) over {yrs[0]:.2f} years; {name}: as counted by CPJ.",
               test="Exact conditional test of two Poisson rates",
               statistic={"gaza_per_year": round(g["killed"] / yrs[0], 1), "other_per_year": round(rate, 1)},
               p=p, effect={"name": f"Rate ratio, Gaza war against the {name}", "value": round(rr, 2), "ci": ci_},
               sources=[{"title": "Israel-Gaza war", "org": "Committee to Protect Journalists", "date": "2026", "url": J["urls"][2]},
                        {"title": "Iraq war and news media: a look inside the death toll", "org": "Committee to Protect Journalists", "date": "March 2013", "url": J["urls"][0]}],
               ref="§10")


def h15():
    U = ext()["unosat"]
    a = U["assessments"]
    t = np.array([(iso(x["date"]) - iso(a[0]["date"])).days for x in a], float)
    d = np.array([x["destroyed"] for x in a], float)
    tau, p_tau = stats.kendalltau(t, d)
    SERIES["h15"] = {"dates": [x["date"] for x in a], "destroyed": [x["destroyed"] for x in a], "affected": [x["affected"] for x in a]}
    record(id="H15a", group="H15", title="Destroyed buildings in Gaza across twelve satellite assessments",
           null="The number of destroyed structures shows no monotonic trend across the assessments.",
           data=f"UNOSAT comprehensive damage assessments, {len(a)} imagery dates from {a[0]['date']} to {a[-1]['date']}.",
           test="Kendall's tau (Mann-Kendall trend test)",
           statistic={"assessments": len(a), "first": int(d[0]), "last": int(d[-1])},
           p=float(p_tau), effect={"name": "Kendall's tau", "value": round(float(tau), 3)},
           sources=[{"title": "Gaza Strip Comprehensive Damage Assessment", "org": "UNOSAT", "date": "2023-2026", "url": U["url"]}],
           ref="§6.4")
    i0 = [x["date"] for x in a].index("2025-10-11")
    k = d[-1] - d[i0]; days = (iso(a[-1]["date"]) - iso(a[i0]["date"])).days
    lo, hi = stats.chi2.ppf(0.025, 2 * k) / 2 / days, stats.chi2.ppf(0.975, 2 * k + 2) / 2 / days
    record(id="H15b", group="H15", title="Buildings destroyed during the October 2025 ceasefire",
           null="No further structures were destroyed in Gaza between the ceasefire of October 2025 and June 2026.",
           data=f"UNOSAT: {int(d[i0]):,} structures destroyed at 11 October 2025, {int(d[-1]):,} at 16 June 2026.",
           test="Count of newly destroyed structures, with an exact Poisson interval for the daily rate",
           statistic={"destroyed_during_ceasefire": int(k), "days": days},
           p=None, effect={"name": "Structures destroyed a day during the ceasefire", "value": round(k / days, 1), "ci": ci(lo, hi)},
           ref="§6.4")


def h16():
    B = ext()["btselem_wars"]
    for w, tid in zip(B["wars"], ["H16a", "H16b", "H16c"]):
        nt = w["not_taking_part"]; known = nt + w["taking_part"] + w["police"]
        bt = stats.binomtest(nt, known, 0.5, alternative="greater")
        lo, hi = bt.proportion_ci(method="exact")
        sens = []
        if w["police"]:
            k2 = nt + w["taking_part"]
            b2 = stats.binomtest(nt, k2, 0.5, alternative="greater")
            sens.append({"name": "Police officers left out rather than counted as taking part", "value": round(nt / k2, 3), "ci": ci(*b2.proportion_ci(method="exact")), "p": float(b2.pvalue)})
        record(id=tid, group="H16", title=f"Palestinians killed who took no part in hostilities: {w['name']}",
               null="No more than half of the Palestinians killed by Israeli forces, of those whose status B'Tselem could determine, took no part in the hostilities.",
               data=f"B'Tselem: {nt:,} took no part, {w['taking_part']:,} took part" + (f", {w['police']} police officers (counted here as taking part)" if w["police"] else "") + f", {w['unknown']} undetermined (left out).",
               test="Exact binomial test against one half (one-sided)",
               statistic={"not_taking_part": nt, "determined": known},
               p=float(bt.pvalue), effect={"name": "Share who took no part in hostilities", "value": round(nt / known, 3), "ci": ci(lo, hi)},
               sensitivity=sens,
               sources=[{"title": "Fatality figures", "org": "B'Tselem", "date": "", "url": u} for u in B["urls"]][:1] if tid == "H16a" else None,
               ref="§10")
        if TESTS[-1]["sources"] is None:
            del TESTS[-1]["sources"]


# ---------------------------------------------------------------- readings

# The tests the dashboard publishes, chosen by the editor.
PUBLISHED = ["H1b", "H2a", "H2b", "H2c", "H3a", "H3b", "H3c", "H4a", "H4b", "H6a", "H6b", "H8b",
             "H9a", "H9b", "H10a", "H10b", "H11a", "H11c", "H13", "H14a", "H14b", "H15a", "H15b", "H16a", "H16c"]

GROUPS = {
    "H1": "Who is killed: age and sex against the population",
    "H2": "The ceasefires",
    "H3": "The ICJ provisional measures orders",
    "H4": "The West Bank before and after 7 October 2023",
    "H5": "Children as a share of the dead",
    "H6": "Is the named list genuine?",
    "H7": "Parliament and the word genocide",
    "H8": "What states have done",
    "H9": "Settler violence and the courts",
    "H10": "Building and demolition in Area C",
    "H11": "Food prices in Gaza",
    "H12": "Aid trucks and food prices",
    "H13": "Detention without charge",
    "H14": "Journalists killed",
    "H15": "The destruction of buildings",
    "H16": "Earlier Gaza wars: who was killed",
}


def pct(x, d=1):
    return f"{100 * x:.{d}f}%"


def hu(x, d=1):
    """Round half up on the value as published, so 7.85 reads 7.9 and 1.115 reads 1.12, as they do on paper."""
    from decimal import Decimal, ROUND_HALF_UP
    return str(Decimal(str(x)).quantize(Decimal(1).scaleb(-d), rounding=ROUND_HALF_UP))


def iv(e, d=2):
    return f"{e['ci'][0]:.{d}g} to {e['ci'][1]:.{d}g}" if e.get("ci") else ""


def readings():
    T = {t["id"]: t for t in TESTS}
    out = {}
    c = T["H1a"]["cells"]
    rng = lambda cs: f"{min(x['ratio'] for x in cs):.1f} to {max(x['ratio'] for x in cs):.1f}"
    men_fa = [x for x in c if x["sex"] == "m" and x["band"] in ("20-24", "25-29", "30-34", "35-39", "40-44", "45-49", "50-54", "55-59")]
    women = [x for x in c if x["sex"] == "f" and x["band"] in ("0-4", "5-9", "10-14", "15-19", "20-24", "25-29", "30-34", "35-39", "40-44", "45-49", "50-54", "55-59")]
    kids = [x for x in c if x["band"] in ("0-4", "5-9")]
    old = [x for x in c if x["band"] in ("75-79", "80+")]
    out["H1a"] = (f"The dead are not distributed as the population is (Cramér's V {T['H1a']['effect']['value']}). Men aged 20 to 59 appear among the dead at {rng(men_fa)} times their share of the population; "
                  f"women and girls under 60 at {rng(women)} times theirs, and children under ten of both sexes at {rng(kids)}. People aged 75 and over are over-represented in both sexes ({rng(old)}).")
    e = T["H1b"]["effect"]
    out["H1b"] = (f"{pct(e['value'])} of the identified dead (95% CI {pct(e['ci'][0])} to {pct(e['ci'][1])}) are women, children under 18 or people aged 60 and over, against {pct(e['population_share'])} of the population. "
                  "More than half of the dead fall outside the group from which armed men are drawn: the dead are not confined to men of fighting age.")
    d = T["H2a"]["descriptive"]; s = T["H2a"]["sensitivity"]
    out["H2a"] = (f"Reported killings fell from {d['before_per_day']} a day in the fortnight before the pause to {d['during_per_day']} a day during it (rate ratio {T['H2a']['effect']['value']}, 95% CI {iv(T['H2a']['effect'])}). "
                  f"Killing did not stop: at least {d['during_killed']} people were reported killed in the {d['during_days']} days. Against the upper bound of 40 deaths the ratio is {s[1]['value']}, still a fall of about 98%.")
    for k in ("H2b", "H2c"):
        d = T[k]["descriptive"]; e = T[k]["effect"]
        out[k] = (f"New killings fell from {d['before_per_day']} a day in the 60 days before to {d['during_per_day']} a day during the ceasefire (rate ratio {e['value']}, 95% CI {iv(e)}). "
                  f"Killing continued throughout: {d['during_killed']:,} new killings were reported in {d['during_days']} days (95% CI {d['during_ci'][0]} to {d['during_ci'][1]} a day).")
    for k in ("H3a", "H3b", "H3c"):
        e = T[k]["effect"]
        out[k] = (f"No detectable change in the level or the trend of daily deaths at the order (level rate ratio {e['value']}, 95% CI {iv(e)}; joint test p = {T[k]['p']:.2f}). "
                  "The order was not followed by a measurable fall in the rate of killing. This is the absence of a detectable change, not proof that the order had no effect on any conduct.")
    e = T["H4a"]["effect"]; st = T["H4a"]["statistic"]
    out["H4a"] = f"Palestinians were killed in the West Bank at {st['after_per_day']} a day after 7 October 2023 against {st['before_per_day']} before it, {e['value']} times the rate (95% CI {iv(e, 3)}), in a year that was already the deadliest on record before the war began."
    e = T["H4b"]["effect"]; s = T["H4b"]["sensitivity"][0]
    out["H4b"] = f"Settler incidents ran at {e['value']} times the 2022 rate in 2024 (95% CI {iv(e, 3)}), and at {s['value']} times even at the rounding bounds least favourable to the finding."
    e = T["H5"]["effect"]; s = T["H5"]["sensitivity"]
    out["H5"] = (f"The share of children among the dead fell over the war: the odds that a person killed was a child fell by a factor of {e['value']} a year (95% CI {iv(e)}). "
                 f"The fall holds when the period after November 2024, when the Ministry rarely updated its child total, is excluded ({s[1]['value']} a year). "
                 "Children were about two in five of the dead in the first months and about one in four by late 2024. The share fell; the number of children killed kept rising.")
    st = T["H6a"]["statistic"]; d = T["H6a"]["descriptive"]
    out["H6a"] = (f"All {st['valid']:,} of the {st['n']:,} identity numbers pass the Population Registry check digit, where fabricated numbers would pass about one time in ten. "
                  f"There are {d['duplicate_ids']} duplicate identity numbers and {d['duplicate_name_and_dob']} duplicate name-and-birth-date pairs, and the stated age agrees with the date of birth in {d['age_dob_checked'] - d['age_dob_disagree']:,} of {d['age_dob_checked']:,} records. "
                  "The list as published is consistent with registry data. These tests cannot detect a real identity number attached to someone who did not die; that question needs matching against other records.")
    st = T["H6b"]["statistic"]
    out["H6b"] = (f"No age heaping: Whipple's index is {st['whipple']} and Myers' index {st['myers']}, against the 2017 census's 100 and 2.4. "
                  "Ages on the list follow from registry dates of birth rather than estimates, which is what a list built from identity records, and not from guesses, should show.")
    ps = {x["party"]: x for x in T["H7"]["parties"]}
    sh = "; ".join(f"{k} {pct(v['share'], 0)} ({v['used']} of {v['speakers']})" for k, v in ps.items())
    out["H7"] = (f"Share of speaking members who used the word: {sh}. The differences are not significant once the false discovery rate is controlled (adjusted p = {T['H7']['p_adjusted']:.3f}; unadjusted {T['H7']['p']:.3f}), "
                 f"and Labour and Conservative members do not differ significantly (Fisher p = {T['H7']['statistic']['fisher_p']:.2f}). Using the word includes rejecting it.")
    st = T["H8a"]["statistic"]
    out["H8a"] = (f"States that recognise Palestine are less likely, not more, to impose one of the recorded sanctions: {st['recognises_and_yes']} of {st['recognises_and_yes'] + st['recognises_and_no']} recognising states against {st['does_not_and_yes']} of {st['does_not_and_yes'] + st['does_not_and_no']} that do not (odds ratio {T['H8a']['effect']['value']}). "
                  "The recorded measures are European and other Western ones. Several of the states taking them, among them Germany, Italy and the Netherlands, do not recognise Palestine, while most recognising states are in Africa, Asia and Latin America and have taken none of these measures. The association reflects region, and the test cannot separate the two.")
    st = T["H8b"]["statistic"]
    out["H8b"] = (f"{st['recognises_and_yes']} of {st['recognises_and_yes'] + st['recognises_and_no']} recognising states have a government that has called it genocide; none of the {st['does_not_and_yes'] + st['does_not_and_no']} non-recognising states has (odds ratio {T['H8b']['effect']['value']}, with a correction for the empty cell).")
    T = {t_["id"]: t_ for t_ in TESTS}
    d = T["H9a"]["descriptive"]
    out["H9a"] = (f"Of Israelis indicted for offences against Palestinians in the West Bank, {pct(d['settler_conviction_rate'], 0)} were convicted in full or in part (95% CI {pct(d['settler_ci'][0], 0)} to {pct(d['settler_ci'][1], 0)}); "
                  f"of Palestinians tried in the military courts, {pct(d['palestinian_conviction_rate'], 2)} were. Only {pct(d['files_ending_in_conviction'], 0)} of the police files Yesh Din followed ended in any conviction. "
                  "The two figures come from different years and different courts, and a partial conviction is counted as a conviction on both sides.")
    e = T["H9b"]["effect"]
    out["H9b"] = f"In {pct(e['value'], 0)} of the attacks Yesh Din documented in 2024, the Palestinian victims chose not to complain to the Israeli police, most citing distrust of the investigation or fear of reprisal. The prosecution figures in H9a therefore start from a minority of the attacks."
    e = T["H10a"]["effect"]
    out["H10a"] = f"Between 2016 and 2020, {T['H10a']['statistic']['approved']} of {T['H10a']['statistic']['applications']:,} Palestinian applications for building permits in Area C were approved: {pct(e['value'])} (95% CI up to {pct(e['ci'][1])}). The Civil Administration told the Knesset that 60-70% of settlement plans are approved. The units differ (permits against plans), but the gap is more than sixty-fold."
    d = T["H10b"]["descriptive"]
    out["H10b"] = f"Of structures the Civil Administration identified as built without a permit in 2022 and the first half of 2023, {pct(d['palestinian_rate'], 0)} of Palestinian structures were demolished against {pct(d['settler_rate'], 0)} of settler structures: the odds of demolition were {T['H10b']['effect']['value']} times higher for a Palestinian structure (95% CI {iv(T['H10b']['effect'])})."
    d = T["H11a"]["descriptive"]; e = T["H11a"]["effect"]
    out["H11a"] = f"During the total blockade of March to May 2025, food prices in Gaza rose {pct(e['value'] - 1, 0)} above the three months before (95% CI {pct(e['ci'][0] - 1, 0)} to {pct(e['ci'][1] - 1, 0)}), from {d['index_before']} to {d['index_after']} times their pre-war level."
    e = T["H11c"]["effect"]; d = T["H11c"]["descriptive"]
    out["H11c"] = f"Across the {T['H11c']['statistic']['months']} months of data, food in Gaza cost on average {e['value']} times its pre-war price (95% CI {iv(e)}), and was above its pre-war price in {T['H11c']['statistic']['months_above_prewar']} of {T['H11c']['statistic']['months']} months. At the peak, in {d['peak_month']}, it cost {d['peak_index']} times as much."
    s = T["H13"]["statistic"]; e = T["H13"]["effect"]
    out["H13"] = f"Israel held on average {s['post_mean']:,} Palestinians in administrative detention, without charge or trial, at each year end since October 2023, against {s['pre_war_mean']:,} in 2008-2022: {e['value']} times as many (95% CI {iv(e, 3)}). Every figure since 2023 is more than four times the highest year before it ({s['pre_war_max']}). These figures exclude those held as 'unlawful combatants'."
    for k in ("H14a", "H14b"):
        s = T[k]["statistic"]; e = T[k]["effect"]
        war = T[k]["title"].split("against the ")[-1]
        out[k] = f"Journalists were killed by Israel in the Gaza war at {s['gaza_per_year']} a year, against {s['other_per_year']} a year in the {war}: {e['value']} times the rate (95% CI {iv(e, 3)}). The Gaza figure is the lowest CPJ has published, after its June 2026 review removed names."
    s = T["H15a"]["statistic"]
    out["H15a"] = f"Destroyed structures rose at every one of the twelve UNOSAT assessments, from {s['first']:,} in November 2023 to {s['last']:,} in June 2026 (Kendall's tau {T['H15a']['effect']['value']}). The destruction was not a single episode; it continued through every phase of the war."
    s = T["H15b"]["statistic"]; e = T["H15b"]["effect"]
    out["H15b"] = f"{s['destroyed_during_ceasefire']:,} more structures were recorded as destroyed between the October 2025 ceasefire and June 2026, about {e['value']:.0f} a day for {s['days']} days. Some will be buildings damaged earlier that later collapsed or were cleared; the satellite count cannot separate those from new demolitions."
    for k in ("H16a", "H16b", "H16c"):
        e = T[k]["effect"]
        out[k] = f"Of those killed whose status B'Tselem could determine, {pct(e['value'], 0)} took no part in the hostilities (95% CI from {pct(e['ci'][0], 0)})." + (" This counts the police officers killed on the first day as taking part, the reading least favourable to the finding." if k == "H16a" else "")
    for t_ in TESTS:
        t_["reading"] = out.get(t_["id"], t_.get("reading", ""))


PROBLEMS = []


def need(cond, msg):
    """A headline claim the results no longer support. Any problem stops the run
    before tests.json is written, so the site keeps the last text that was true."""
    if not cond:
        PROBLEMS.append(msg)


def build_primer(T):
    g = lambda i: T[i]
    e3 = T["H3a"]["effect"]
    h2 = [T[k] for k in ("H2a", "H2b", "H2c")]
    h3 = [T[k] for k in ("H3a", "H3b", "H3c")]
    need(T["H3a"]["result"] == "null not rejected", "H3a: the first ICJ order now shows a detectable change")
    need(all(t["result"] == "null not rejected" for t in h3), "H3: an ICJ order now shows a detectable change")
    need(all(t["result"] == "null rejected" and t["p_adjusted"] < 0.001 for t in h2), "H2: a ceasefire result is no longer p < 0.001")
    need(all(t["descriptive"]["during_killed"] > 0 for t in h2), "H2: killing stopped during a ceasefire")
    st, ds = T["H6a"]["statistic"], T["H6a"]["descriptive"]
    need(st["valid"] == st["n"] and ds["duplicate_ids"] == 0 and ds["age_dob_disagree"] == 0, "H6: the named list no longer passes every internal test")
    h1 = T["H1b"]
    need(h1["result"] == "null rejected", "H1b: the dead are now consistent with men of fighting age only")
    a4, b4 = T["H4a"], T["H4b"]
    need(a4["result"] == "null rejected" and b4["result"] == "null rejected", "H4: a West Bank result is no longer rejected")
    h8 = T["H8b"]
    need(h8["statistic"]["does_not_and_yes"] == 0 and h8["result"] == "null rejected", "H8b: a non-recognising state now has a government calling it genocide")
    h16 = (T["H16a"], T["H16c"])
    need(all(t["result"] == "null rejected" for t in h16), "H16: a share is no longer above one half")
    need(all(T[k]["result"] == "null rejected" for k in ("H9a", "H9b", "H10a", "H11c", "H13", "H14a", "H14b", "H15a")), "H9 to H15: a result is no longer rejected")
    return {
        "title": "Start here: what a hypothesis test is",
        "lede": "A hypothesis test asks whether a pattern in the numbers is real or could be luck. It does not prove a claim directly; it asks whether the data would be too surprising if nothing were going on.",
        "steps": [
            {"head": "Null hypothesis", "text": "The \"nothing is going on\" answer, for example: the ICJ order did not change the daily death rate. It is presumed true until the data make it hard to believe."},
            {"head": "p-value", "text": "How likely data this extreme would be if the null were true. Under 0.05 (5%) rejects the null. It is not the chance the claim is true, and it says nothing about size."},
            {"head": "Effect and interval", "text": "The size of the difference, often a ratio: 1 is no change, 2 is doubled, 0.5 is halved. The 95% interval is the range the data allow; if it includes 1, no change is still possible."},
            {"head": "Many tests", "text": "Some tests pass by luck, so each p-value is also adjusted across every test run (Benjamini-Hochberg, 5%). Both are shown."},
            {"head": "\"Not rejected\"", "text": "This does not prove the null. It means no change was detected; check the interval for what was ruled out."},
        ],
        "example": f"First ICJ order, 26 January 2024: the rate afterwards was {e3['value']:.3f} times the rate before (95% interval {e3['ci'][0]:.2f} to {e3['ci'][1]:.2f}, adjusted p {T['H3a']['p_adjusted']:.2f}). No detectable change, so the null is not rejected.",
        "groups": [
            {"head": "Established: the null is rejected", "items": [
                f"The named list is internally genuine: all {st['n']:,} identity numbers pass the check digit (an invented one passes about 1 time in 10), none is duplicated, and ages match dates of birth (H6).",
                f"The dead are not just men of fighting age: {pct(h1['effect']['value'])} (interval {pct(h1['effect']['ci'][0])} to {pct(h1['effect']['ci'][1])}) are women, under-18s or aged 60 and over (H1b).",
                f"Each ceasefire cut the rate of killing and none stopped it: ratios {h2[0]['effect']['value']:.2g}, {h2[1]['effect']['value']:.2g} and {h2[2]['effect']['value']:.2g}, all adjusted p < 0.001 (H2).",
                f"In the West Bank the killing rate after 7 October 2023 was {hu(a4['effect']['value'])} times the earlier rate ({hu(a4['effect']['ci'][0])} to {hu(a4['effect']['ci'][1])}), and settler incidents in 2024 were {hu(b4['effect']['value'])} times the 2022 rate (H4).",
                f"Settler convictions are rare (odds ratio {T['H9a']['effect']['value']:.2g} against Palestinians); {pct(T['H9b']['effect']['value'], 0)} of Palestinian victims do not complain to the police; {pct(T['H10a']['effect']['value'], 2)} of Area C building applications are approved (H9, H10).",
                f"Food costs {T['H11c']['effect']['value']:.1f} times pre-war prices; detention without charge is {hu(T['H13']['effect']['value'])} times its 2008 to 2022 level; journalists are killed at {T['H14a']['effect']['value']:.1f} times the Iraq war rate and {T['H14b']['effect']['value']:.1f} times Syria's; destroyed buildings rose at every satellite assessment (H11, H13 to H15).",
                f"In the 2008-09 and 2014 wars, {pct(h16[0]['effect']['value'])} and {pct(h16[1]['effect']['value'])} of those killed took no part in the hostilities, on B'Tselem's count (H16).",
                f"No state withholding recognition of Palestine has a government that has called Gaza genocide; {h8['statistic']['recognises_and_yes']} recognising states do. The odds ratio is {h8['effect']['value']:.2g}, but the interval ({h8['effect']['ci'][0]:.2g} to {round(h8['effect']['ci'][1], -1):.0f}) is wide: the direction is clear, the size is not (H8).",
            ]},
            {"head": "Not detected: the null is not rejected", "items": [
                f"The three ICJ orders of 2024 were not followed by a detectable change in the daily death rate: ratios {h3[0]['effect']['value']:.3f}, {hu(h3[1]['effect']['value'], 2)} and {hu(h3[2]['effect']['value'], 2)}, adjusted p {h3[0]['p_adjusted']:.2f}, {h3[1]['p_adjusted']:.2f} and {h3[2]['p_adjusted']:.2f}. The intervals are wide enough that a modest change cannot be excluded (H3).",
            ]},
            {"head": "What no test here establishes", "items": [
                "Why a rate changed: a change at a dated event is an association, not proof of cause.",
                "Who is missing from the named list: the unidentified, and the dead under the rubble.",
                "Any legal conclusion: a statistical pattern is not a finding of genocide, war crimes or intent.",
                "More than the data allow: where a result depends on a data weakness, its entry says so.",
            ]},
        ],
    }


def build_findings(T):
    st = T["H6a"]["statistic"]
    h1 = T["H1b"]["effect"]["value"]
    a4, b4 = T["H4a"]["effect"]["value"], T["H4b"]["effect"]["value"]
    h9 = T["H9a"]["descriptive"]
    h10a, h10b = T["H10a"]["effect"]["value"], T["H10b"]["effect"]["value"]
    need(h1 > 0.5, "H1b: the share of women, children and the elderly is no longer a majority")
    need(a4 > 4, "H4a: the West Bank rate ratio is no longer above four")
    need(h10a < 0.01, "H10a: Area C approvals are no longer under 1%")
    need(T["H14a"]["effect"]["value"] > 4 and T["H14b"]["effect"]["value"] > 4, "H14: the journalist rate ratios are no longer above four")
    need(T["H16a"]["effect"]["value"] > 0.5 and T["H16c"]["effect"]["value"] > 0.5, "H16: most of those killed no longer took no part")
    return [
        ("The named list of the dead is genuine on every internal test.",
         f"Every one of the {st['n']:,} identity numbers on the Ministry of Health list passes the Population Registry check digit, which a fabricated number passes about one time in ten; none is duplicated; and every stated age agrees with its date of birth.", "H6a"),
        ("The dead are not confined to men of fighting age.",
         f"{pct(h1, 0)} of the identified dead are women, children or people aged 60 and over.", "H1b"),
        ("Every ceasefire cut the rate of killing, and none stopped it.",
         "Killings continued through the November 2023 pause, the January to March 2025 ceasefire and the ceasefire in force since October 2025.", "H2c"),
        ("The three ICJ provisional measures orders of 2024 were not followed by any detectable fall in the daily death rate.", "", "H3a"),
        (f"In the West Bank, Palestinians were killed at {a4:.1f} times the earlier rate after 7 October 2023,",
         f"and settler incidents in 2024 ran at {b4:.1f} times the 2022 rate.", "H4a"),
        ("No state that withholds recognition of Palestine has a government that has called the conduct in Gaza genocide;",
         f"{T['H8b']['statistic']['recognises_and_yes']} recognising states do.", "H8b"),
        ("Settlers who attack Palestinians are rarely convicted.",
         f"Only {pct(h9['files_ending_in_conviction'], 0)} of the police files Yesh Din followed ended in a conviction, and an indicted settler is convicted in about {pct(h9['settler_conviction_rate'], 0)} of cases, against {pct(h9['palestinian_conviction_rate'])} for Palestinians in the military courts.", "H9a"),
        (f"In Area C, under 1% of Palestinian building applications are approved,",
         f"and the odds of demolition are {h10b:.1f} times higher for an unpermitted Palestinian structure than for a settler's.", "H10b"),
        (f"Food prices rose by about {pct(T['H11a']['effect']['value'] - 1, 0)} during the total blockade of 2025,", f"and across the war food has cost {T['H11c']['effect']['value']:.1f} times its pre-war price.", "H11a"),
        (f"Administrative detention without charge is {hu(T['H13']['effect']['value'])} times its 2008-2022 level.", "", "H13"),
        (f"Journalists have been killed at {T['H14a']['effect']['value']:.1f} times the rate of the Iraq war and {T['H14b']['effect']['value']:.1f} times that of Syria's,", "on CPJ's lowest count.", "H14a"),
        (f"Destroyed buildings rose at every satellite assessment, and about {round(T['H15b']['statistic']['destroyed_during_ceasefire'], -2):,} more were recorded destroyed after the October 2025 ceasefire.", "", "H15b"),
        ("In the 2008-09 and 2014 Gaza wars, most of those killed took no part in the hostilities, on B'Tselem's case-by-case count.", "", "H16c"),
    ]


def build_method(unidentified):
    return [
        ("Tests", "Counts are modelled as negative binomial, after a likelihood-ratio test rejected the Poisson model in every series where it was applied. Time series use Newey-West standard errors with a lag of seven days. Rates are compared with the exact conditional test for two Poisson rates. Two-by-two tables use Fisher's exact test."),
        ("Multiple testing", None),  # filled from the correction line
        ("Caution", None),           # filled from the caution line
        ("What the tests are not", f"A test of a ceasefire or a court order measures whether the death rate changed around a date, not why. A test on the named list measures the list as published, not the deaths it does not contain: the {unidentified:,} counted dead who have not been identified, and the dead still under the rubble, are outside it."),
        ("Limits", "The tests are only as good as the data. The Ministry of Health's daily series changed source during the war (to the Government Media Office from 11 November 2023, and back), carries days on which no report was issued, and, from 2025, separates new killings from bodies recovered only on some days. The named list covers the identified dead only. The population baseline is the PCBS projection for 2023, before the war. Where a test depends on one of these weaknesses, its entry says so, and a sensitivity analysis tests whether the result survives it."),
    ]



# ---------------------------------------------------------------- main

def main():
    people = named_list()
    h1(people)
    dates, total, new = series()
    h2(dates, total, new)
    h3(dates, total)
    h4()
    h5()
    h6(people)
    h7()
    h8()
    h9()
    h10()
    h11()
    h12()
    h13()
    h14()
    h15()
    h16()
    corr = [t for t in TESTS if t.get("p") is not None]
    rej, padj, _, _ = multipletests([t["p"] for t in corr], alpha=0.05, method="fdr_bh")
    for t, r, q in zip(corr, rej, padj):
        t["p_adjusted"] = float(q)
        t["result"] = "null rejected" if r else "null not rejected"
    for t in TESTS:
        t.setdefault("status", "run")
        if t["id"] == "H6b":
            t["result"] = t["effect"]["scale"]
        if t["id"] == "H6a":
            t["result"] = t["decision"] + "; the 10% fabrication benchmark is rejected" if t["p_adjusted"] < 0.05 else t["decision"]
    readings()
    T_ = {t["id"]: t for t in TESTS}
    PRIMER = build_primer(T_)
    FINDINGS = build_findings(T_)
    last = daily()[-1]
    METHOD = build_method(int(last.get("ext_killed_cum") or last["killed_cum"]) - len(people))
    if PROBLEMS:
        print("tests.json NOT written: these headline claims no longer hold, and the text must be reviewed:", file=sys.stderr)
        for m in PROBLEMS:
            print("  -", m, file=sys.stderr)
        raise SystemExit(2)
    commit = subprocess.run(["git", "log", "-1", "--format=%h %cs", "--", "PREREGISTRATION.md"], cwd=HERE, capture_output=True, text=True).stdout.split()
    out = {
        "meta": {
            "title": "Statistical tests on the record",
            "description": "Pre-registered hypothesis tests on the data this dashboard publishes: the age and sex of the identified dead, the ceasefires and the ICJ orders against the daily death rate, the West Bank before and after 7 October 2023, the share of children over time, the integrity of the Ministry of Health named list, party and the word genocide in the House of Commons, and recognition of Palestine against the other measures states have taken. Every result is published, whichever way it falls.",
            "generated": dt.date.today().isoformat(),
            "data_to": dates[-1].isoformat(),
            "preregistration": {"commit": commit[0] if commit else None, "date": commit[1] if len(commit) > 1 else None,
                                "url": "preregistration.md",
                                "note": "Committed to the source repository, which is not public, before the analysis script existed; the file is published here unchanged."},
            "correction": f"Benjamini-Hochberg false discovery rate at 5% across the {len(corr)} tests with a p-value.",
            "caution": "A change in a series at a dated event is an association, not proof that the event caused it. Tests on the named list inherit any bias in who has been identified.",
        },
        "groups": GROUPS,
        "departures": DEPARTURES,
        "tests": TESTS,
    }
    # The full set stays in the source repository; the site publishes the tests
    # selected by the editor (PUBLISHED), with the adjusted p-values still
    # computed across every test that was run.
    if not SITE_ONLY:
        (HERE / "results-full.json").write_text(json.dumps(out, ensure_ascii=False, indent=1, default=float))
    shown = [t_ for t_ in TESTS if t_["id"] in PUBLISHED]
    site = {
        "meta": {
            "title": "Statistical tests on the record",
            "description": "Hypothesis tests on the data this dashboard publishes: whether the identified dead are confined to men of fighting age, "
                           "whether killing continued through the ceasefires, whether the ICJ orders changed the daily death rate, the West Bank before and after "
                           "7 October 2023, the integrity of the Ministry of Health named list, and recognition of Palestine against governments calling it genocide.",
            "generated": out["meta"]["generated"],
            "data_to": out["meta"]["data_to"],
            "correction": f"p-values are adjusted for the false discovery rate (Benjamini-Hochberg, 5%) across all {len(corr)} tests run in the analysis.",
            "caution": out["meta"]["caution"],
            "findings": [{"head": h, "text": x, "test": tid} for h, x, tid in FINDINGS],
            "primer": PRIMER,
            "method": [{"title": k, "text": v if v is not None else (
                f"{out['meta']['correction'].replace('Benjamini-Hochberg false discovery rate at 5% across the', 'p-values are adjusted for the false discovery rate (Benjamini-Hochberg, 5%) across all the')} Both raw and adjusted p-values are reported."
                if k == "Multiple testing" else out["meta"]["caution"])} for k, v in METHOD],
        },
        "series": {**{k: v for k, v in SERIES.items() if k.upper() in {t_["group"] for t_ in shown}},
                   "h6": {"ages": next(t_ for t_ in TESTS if t_["id"] == "H6b")["ages"]}},
        "groups": {k: v for k, v in GROUPS.items() if any(t_["group"] == k for t_ in shown)},
        "tests": shown,
    }
    # A night on which nothing moved must not produce a commit: keep the old
    # generation date when everything else is identical to what is published.
    path = DATA / "tests.json"
    if path.exists():
        prev = json.loads(path.read_text())
        now = json.loads(json.dumps(site, default=float))
        strip = lambda d: {**d, "meta": {**d["meta"], "generated": None}}
        if strip(prev) == strip(now):
            site["meta"]["generated"] = prev["meta"]["generated"]
    path.write_text(json.dumps(site, ensure_ascii=False, separators=(",", ":"), default=float))
    for t in TESTS:
        e = t.get("effect") or {}
        print(f"{t['id']:4} p={t.get('p')!s:10.10} q={t.get('p_adjusted', '-')!s:10.10} {e.get('name', '')[:38]:38} {e.get('value')} {e.get('ci', '')} {t.get('result', t['status'])}")
    for d in DEPARTURES:
        print("DEPARTURE", d["test"], d["text"][:160])


if __name__ == "__main__":
    main()
