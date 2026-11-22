# Wartungs-Manager

<img src="custom_components/ha_wartung/brand/icon.png" alt="Wartungs-Manager icon" width="64" height="64">

A local maintenance dashboard for Home Assistant: device records, recurring and one-off tasks, service history, batteries and other consumables.

[Deutsche Anleitung](README.de.md) · [Report a problem](https://github.com/Raffaelloo22/homeassistant-wartungs-manager/issues)

## What it does

- Keep manual device records or link them to Home Assistant devices. Import selected Home Assistant device types with a preview and duplicate checks.
- Plan tasks by date, interval, season, rotation, sensor value or device indication. Record completion dates, costs and notes, and edit the resulting history.
- Link tasks to batteries or other consumables. Confirm stock deductions on completion; quantities for batteries come from the device record.
- Track stock, purchase thresholds, purchase requests, notes and the devices that use each item.
- Find low batteries in the task view using a shared Home Assistant threshold helper.
- Organize devices as active, stored, archived or in the trash; edit categories and event types.
- Export and import the directory as JSON. An optional weekly summary appears as a Home Assistant persistent notification.

The dashboard has **Aufgaben** (tasks), **Geräte** (devices), **Verbrauchsmaterial** (consumables), **Log** and **Einstellungen** (settings). On phones, the tabs use icons and consumables use compact cards with a stock button and an actions menu.

## Requirements

- Home Assistant **2026.11.0 or newer**.
- A Home Assistant administrator account. The dashboard and its API are administrator-only.
- No cloud account, external subscription or vendor integration is required. Devices without a Home Assistant counterpart can be entered manually.

The setup flow is available in English and German. This first public release uses German dashboard text, `dd.mm.yy` dates and decimal points. The currency for costs is configurable; existing installations retain CHF, while a fresh setup uses the Home Assistant currency when available. The integration name remains Wartungs-Manager in both languages.

## Installation

### Marketplace or HACS

[Open this repository in Home Assistant](https://my.home-assistant.io/redirect/hacs_repository/?owner=Raffaelloo22&repository=homeassistant-wartungs-manager&category=integration).

Before the repository is included in the shared catalog, add `https://github.com/Raffaelloo22/homeassistant-wartungs-manager` as a custom repository of type **Integration** in Marketplace or HACS. Download a release and follow the restart prompt if Home Assistant shows one.

Then open **Settings → Devices & services → Add integration**, search for **Wartungs-Manager**, and complete setup. Open **Wartung** in the sidebar.

[Start the integration setup](https://my.home-assistant.io/redirect/config_flow_start/?domain=ha_wartung).

Marketplace is built into Home Assistant starting with 2026.11 and uses the same repository catalog as HACS. Catalog inclusion is a separate review; a working installation link does not mean this repository has been accepted into the catalog.

### Manual installation

1. Download a release from this repository.
2. Copy the `custom_components/ha_wartung` directory into your Home Assistant configuration directory's `custom_components` directory. Preserve the folder name `ha_wartung`.
3. Restart Home Assistant.
4. Add **Wartungs-Manager** under **Settings → Devices & services**.

Only one Wartungs-Manager directory is configured per Home Assistant instance. It starts empty: the release contains no household records, imported devices or example tasks.

## First steps

1. Open **Geräte** and add a device, or use **Sammelerfassung von Home Assistant Geräten** to preview selected device types before importing them.
2. Assign a category and, for replaceable batteries, enter the battery type and quantity. Areas come from the linked Home Assistant device.
3. Open a device and choose **Neue Aufgabe**. A new task defaults to **Termin**, a one-off date. Use an interval, season or rotation for work that repeats.
4. Add batteries and materials in **Verbrauchsmaterial**, then link them to the relevant tasks and devices.
5. Record completions in **Aufgaben**. The completion dialog asks before reducing linked stock. A completion can be undone for 30 seconds; history remains editable later.

For task periods, **Jetzt** means due or requiring attention. **Bald** covers tomorrow through the next 14 days, inclusive. **Alle** shows all open tasks. A completed one-off task stays in history; a completed recurring task is grouped with its next date in the device record until it becomes due again.

## Battery warnings and sensor tasks

Battery warnings use `input_number.batterien_schwellwert` by default. The dashboard checks for this default helper when opened and creates it with an initial value of 20% if it does not exist. It preserves an existing helper and its value. In the general settings, you can select an existing `input_number` helper instead. The slider in **Einstellungen → Batteriewarnung** writes to the selected helper. You can also configure the currency used for costs in the general settings.

A valid battery percentage triggers a warning only when it is **strictly below** the threshold. An unknown, unavailable or invalid battery level does not trigger a percentage warning. If the helper is absent or unavailable, the dashboard identifies the fallback threshold of 20%. Archived, stored and trashed devices are excluded, as are devices whose battery warning is disabled.

These percentage warnings are calculated in the dashboard. They are not separate persisted maintenance rules and are currently **not included in the weekly summary**. Recording a battery change does not change the physical sensor's reported percentage.

A **Messwert** task uses a selected Home Assistant sensor and a numerical threshold. The form shows the current sensor value and unit. Unknown, unavailable, restored or non-numerical values remain pending. After completion, a newer Home Assistant report is required before the task can become due again. A Home Assistant state report is not proof of a new physical measurement.

## Data, backups and updates

Device records, tasks, history, stock and settings are stored locally through Home Assistant's storage API, outside the integration's code directory. A full Home Assistant backup that includes the configuration directory includes these files. There is no telemetry or automatic upload of maintenance records.

**Einstellungen → Daten exportieren und importieren** provides a separate JSON export. Exports can contain device names, serial numbers, notes and purchase information; treat them as private. Import replaces the existing directory and requires explicit confirmation. It is not a merge.

Update through Marketplace or HACS, then follow Home Assistant's restart prompt. Keep a current Home Assistant backup before updating. The integration domain and storage name remain `ha_wartung`, preserving existing directories when this package replaces an earlier installation of the same integration. Do not install two repositories providing this domain at the same time.

**Daten zurücksetzen** permanently clears device, task, history, purchasing and consumable data. It retains category and event-type names and order, and general settings. It does not remove Home Assistant devices, entities, automations or the threshold helper.

## Removing the integration

Remove **Wartungs-Manager** under **Settings → Devices & services**, then remove its code through Marketplace or HACS and restart when prompted. This removes the sidebar panel; it does not erase saved maintenance data or the battery threshold helper. Re-adding the integration can load the retained directory.

If you want to erase the maintenance directory, export anything you need and use **Daten zurücksetzen** before removing the integration. That reset retains general settings, categories and event types. Remove an unused threshold helper separately in Home Assistant only after checking that no other automation or dashboard uses it. Do not edit `.storage` files by hand.

## Troubleshooting and limits

- **No sidebar entry:** sign in as an administrator, confirm that the integration was added, then reload the page. After an update, follow any restart prompt.
- **Sensor task remains pending:** check that the selected sensor exists and reports a number. A text state such as `not_charging` cannot be compared with a percentage threshold.
- **Battery task remains after a change:** the reported battery percentage still controls the warning. The sensor may need time to report a new value.
- **Duplicate import concern:** review the import preview. Existing Home Assistant device links and name conflicts are skipped; differently named manual records need your review.
- **Unexpected stock:** check the linked task material and its quantity. Negative stock represents missing items; it is permitted for other consumables.
- **Weekly summaries:** these are persistent notifications inside Home Assistant, not mobile push messages or email. Their planning horizon is seven days, while the dashboard's **Bald** filter uses 14 days.

Use [Issues](https://github.com/Raffaelloo22/homeassistant-wartungs-manager/issues) for bugs and feature requests. Include the Home Assistant version, Wartungs-Manager version and steps to reproduce, with anonymized screenshots or logs. Do not post exports, access tokens or private household information. See [SECURITY.md](SECURITY.md) for security reports and [CONTRIBUTING.md](CONTRIBUTING.md) for development.

## License

[MIT](LICENSE). Copyright © 2026 Raffaelloo22.
