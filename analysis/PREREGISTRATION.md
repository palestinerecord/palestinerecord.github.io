# Pre-registration: statistical tests on the dashboard data

Registered 2 October 2026, before any of the tests below was run. This file is committed to the repository before the analysis script exists, so the commit history shows that the hypotheses, the tests, the data and the decision rules were fixed first. Any departure from it in the analysis is reported as a departure, with the reason.

## General rules

- Significance level 0.05, two-sided unless stated. Every primary test is listed in the table at the end; the Benjamini-Hochberg procedure controls the false discovery rate at 5% across all of them, and both the raw and the adjusted p-values are reported.
- Every result is reported with an effect size and a 95% confidence interval, not a p-value alone.
- Every result is published, whichever way it falls, including any that cuts against the conclusions of the report.
- Count data are modelled as negative binomial, not Poisson, unless a test of overdispersion fails to reject the Poisson model. Time series use heteroskedasticity- and autocorrelation-consistent (Newey-West) standard errors with a lag of 7 days.
- A change in a time series at a dated event is an association. No test here is read as establishing that the event caused the change.
- Data are the files the dashboard publishes, or the raw files from which they are built, as fetched on 2 October 2026. The named list of the identified dead is used in full (72,835 records), not the one-in-three sample the dashboard ships.

## H1. Age and sex of the identified dead against the population of Gaza

Data: the Ministry of Health named list of identified dead (Tech For Palestine, `killed-in-gaza`, 72,835 records with age and sex); the Gaza Strip population by sex and five-year age band for 2023 (PCBS projection supplied through UNFPA, COD-PS 2023, `data/raw/pse_admpop_2023.xlsx`). Ages are banded to match: 0-4, 5-9, ..., 75-79, 80+.

- **H1a.** Null: the identified dead are distributed across the 34 sex-age cells in proportion to the population (the pattern of indiscriminate killing). Test: chi-square goodness of fit. Effect: Cramér's V, and the ratio of observed to expected deaths in each cell.
- **H1b.** Null: the identified dead are confined to men aged 18-59 (the pattern of killing restricted to the group from which armed men are drawn). Test: exact binomial test of the share of the dead who are women, children under 18 or adults aged 60 and over, against a share of zero; reported with its Wilson interval and set beside the same share in the population.
- Secondary, descriptive: the male-to-female ratio of the dead in each age band, against the ratio in the population.
- Stated limit: the list covers identified dead only. If identification is more or less likely for some groups than others, the test inherits that bias.

## H2. The ceasefires and the daily killing rate in Gaza

Data: the Ministry of Health daily series as compiled by Tech For Palestine (`data/raw/v2_casualties_daily.min.json`). Daily deaths are the increments of the cumulative total. Where the series separates new killings (`killed_truce_new`) from bodies recovered (`killed_recovered`), the ceasefire-period count uses new killings only, since recovered bodies are deaths from earlier periods.

Three ceasefire periods: the pause of 24-30 November 2023; the ceasefire in force from 19 January 2025 until the resumption of bombing on 18 March 2025; and the ceasefire in force from 10 October 2025 to the end of the series.

- **H2a, H2b, H2c.** For each period, null: the daily rate of new killings during the ceasefire equals the rate in the comparison window before it (the 14 days before the November 2023 pause; the 60 days before each of the other two). Test: negative binomial regression of daily deaths on a ceasefire indicator, Newey-West errors. Effect: rate ratio with 95% interval.
- Secondary, descriptive: the rate of new killings per day during each ceasefire, with its interval, which answers whether killing continued.
- Sensitivity: the same tests on weekly totals, to remove day-to-day reporting artefacts.

## H3. The ICJ provisional measures orders and the daily killing rate

Data: the daily series as in H2, from 1 December 2023 to 31 July 2024.

- **H3a, H3b, H3c.** Null: no change in the level or the slope of daily deaths at the orders of 26 January 2024, 28 March 2024 and 24 May 2024. Test: segmented negative binomial regression with a linear trend and a level and slope change at each order, Newey-West errors; one joint Wald test per order (level and slope together). Effect: the rate ratio for the level change at each order.
- Stated limit: the Rafah offensive began in early May 2024, and military operations changed throughout the period. A change at an order date cannot be separated from what else happened that week.

## H4. The West Bank before and after 7 October 2023

Data: `data/history.json` (OCHA figures as carried by the report).

- **H4a.** Null: the rate of Palestinians killed in the West Bank per day was the same from 7 October to 31 December 2023 as from 1 January to 6 October 2023 (208 killed in 279 days; 299 in 86 days). Test: exact conditional test of two Poisson rates (binomial). Effect: rate ratio with exact interval.
- **H4b.** Null: the rate of settler incidents against Palestinians was the same in 2024 as in 2022. Test: as H4a, using OCHA's daily averages (2 and 7 a day) over 365 days. Stated limit: the averages are rounded; the test is repeated at the rounding bounds least favourable to rejection (2.5 and 6.5 a day).

## H5. The share of children among the dead over time

Data: the daily series as in H2; monthly deaths and monthly child deaths from the differences of the cumulative totals at each month end (`ext_killed_cum`, `ext_killed_children_cum`), October 2023 to September 2026.

- **H5.** Null: the share of children among those killed did not change over time. Test: quasi-binomial regression of the monthly share on a linear month trend, weighted by monthly deaths. Effect: the odds ratio per year with its interval.
- Sensitivity: the same model with a break at May 2024, when the Ministry began distinguishing identified from reported dead in its breakdowns.

## H6. The integrity of the named list

Data: the full named list as in H1, with identity number, date of birth, age and sex.

- **H6a.** Null: the identity numbers are valid registry numbers. Palestinian identity numbers carry the check digit of the Population Registry (the Israeli identity-number algorithm). A fabricated nine-digit number passes it by chance about one time in ten. Test: the share passing, with its interval, against the 10% expected under fabrication (exact binomial). The null of validity is rejected for the list as a whole if fewer than 99% pass.
- **H6b.** Null: age reporting shows no more heaping on ages ending in 0 and 5 than a registry-based list would. Test: Whipple's index on ages 23-62 (UN scale: under 105 highly accurate; 105-109.9 fairly accurate; 110-124.9 approximate; 125 and over rough), and Myers' blended index on ages 10-89, set beside the indices PCBS reports for its 2017 census (Whipple 1.0, i.e. 100 on this scale; Myers 2.4).
- Secondary, descriptive: duplicate identity numbers; records whose stated age disagrees with the date of birth by more than one year at any date in the war.

## H7. Party and the word "genocide" in the House of Commons

Data: the full Hansard text of the 188 Commons and Westminster Hall debates on Gaza, Israel or Palestine since 7 October 2023 held in `data/raw/hansard/`, and party affiliation from `data/constituency.json`. A member counts as using the word if any of their contributions in these debates contains a word beginning "genocid".

- **H7.** Null: among members who spoke in these debates, use of the word is independent of party. Test: chi-square test of independence across parties with at least 10 speaking members, the others pooled; Fisher's exact test for Labour against Conservative. Effect: Cramér's V, and the share of each party's speakers who used the word.
- Stated limit: using the word includes rejecting it. The test measures whether the term enters a member's speech, not what they said about it.

## H8. Recognition of Palestine and the other measures states have taken

Data: `data/world-positions.json`, UN member states only.

- **H8a.** Null: whether a state imposes any of the sanctions recorded at §15.3 is independent of whether it recognises the State of Palestine. Test: Fisher's exact test. Effect: odds ratio with its interval.
- **H8b.** Null: whether a state's government has called the conduct in Gaza genocide (position "says") is independent of whether it recognises the State of Palestine. Test and effect as H8a.

## Primary tests under the false discovery rate correction

H1a, H1b, H2a, H2b, H2c, H3a, H3b, H3c, H4a, H4b, H5, H6a, H6b, H7, H8a, H8b: sixteen tests. H6b has no p-value under the UN scale; it is reported against the scale and the census benchmark and is excluded from the correction, which therefore covers fifteen.
