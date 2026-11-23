"""Exercise a running, disposable Home Assistant through its public APIs.

Executed inside the official Core container so aiohttp is already available.
Never point this probe at a real household: it creates only synthetic fixtures.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
import secrets
import sys

from aiohttp import ClientSession, ClientTimeout

BASE = "http://127.0.0.1:8123"
CLIENT = "http://127.0.0.1:18767/"
STATE = Path("/config/release-test-state.json")
DOMAIN = "ha_wartung"


def check(value, message):
    if not value:
        raise AssertionError(message)


class AuthenticationError(AssertionError):
    """The server rejected a token; retrying startup cannot repair it."""


class API:
    def __init__(self, session, token=None):
        self.session, self.token = session, token

    async def request(self, method, path, value=None, form=False):
        headers = {"Authorization": "Bearer " + self.token} if self.token else {}
        kwargs = {"headers": headers}
        if value is not None:
            kwargs["data" if form else "json"] = value
        async with self.session.request(method, BASE + path, **kwargs) as response:
            text = await response.text()
            check(response.status < 400, f"{method} {path}: HTTP {response.status}: {text[:500]}")
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return text

    async def ws(self, command=None, *, expect_error=None):
        async with self.session.ws_connect(BASE + "/api/websocket") as websocket:
            check((await websocket.receive_json())["type"] == "auth_required", "WS authentication handshake")
            await websocket.send_json({"type": "auth", "access_token": self.token})
            auth = await websocket.receive_json()
            if auth.get("type") == "auth_invalid":
                raise AuthenticationError("WS authentication rejected")
            check(auth.get("type") == "auth_ok", "WS authentication")
            if command is None:
                return None
            await websocket.send_json({"id": 1, **command})
            result = await websocket.receive_json()
            check(result.get("id") == 1 and result.get("type") == "result", f"WS response: {result}")
            if expect_error:
                check(not result.get("success") and result.get("error", {}).get("code") == expect_error,
                      f"Expected {expect_error}: {result}")
                return result
            check(result.get("success"), f"WS {command['type']}: {result}")
            return result.get("result")

    async def action(self, action, **payload):
        return await self.ws({"type": DOMAIN + "/request", "action": action, "payload": payload})

    async def mutate(self, action, **payload):
        current = await self.action("get", fields=["revision"])
        return await self.action(action, revision=current["revision"], **payload)


async def wait_ready(api):
    for attempt in range(180):
        try:
            await api.request("GET", "/api/onboarding")
            return
        except Exception:
            await asyncio.sleep(1)
    raise AssertionError("Disposable Home Assistant did not become ready in 180 seconds")


async def token_grant(api, grant):
    return await api.request("POST", "/auth/token", {**grant, "client_id": CLIENT}, form=True)


async def access_token(api, code):
    result = await token_grant(api, {"grant_type": "authorization_code", "code": code})
    return result["access_token"]


async def refresh_api(session, state):
    anonymous = API(session)
    await wait_ready(anonymous)
    try:
        await API(session, state["token"]).ws()
    except AuthenticationError:
        print("WARNING: Previous access token was rejected; validating the persisted refresh grant.", flush=True)
    # This must use the saved grant: a fresh login could hide lost auth storage.
    # HTTP errors (including invalid_grant) intentionally fail the test.
    result = await token_grant(anonymous, {
        "grant_type": "refresh_token", "refresh_token": state["refresh_token"],
    })
    api = API(session, result["access_token"])
    await api.ws()
    state["token"] = api.token
    return api


async def configure(api):
    flow = await api.request("POST", "/api/config/config_entries/flow", {"handler": DOMAIN})
    check(flow["type"] == "form", f"Config flow first step: {flow}")
    result = await api.request("POST", "/api/config/config_entries/flow/" + flow["flow_id"], {})
    check(result["type"] == "create_entry", f"Config flow creation: {result}")
    entry_id = result["result"]["entry_id"]
    for attempt in range(60):
        try:
            await api.action("get", fields=["revision"])
            return entry_id
        except Exception:
            await asyncio.sleep(1)
    raise AssertionError("Integration setup did not complete")


async def assert_snapshot(api, expected):
    actual = await api.action("export")
    check(actual == expected, "Persistent export changed across lifecycle operation")
    snapshot = await api.action("get")
    if "battery_threshold_entity" in snapshot["settings"]:
        check(snapshot["settings"]["currency"] == "EUR", "Currency preference persisted")
        helper_entity = snapshot["settings"]["battery_threshold_entity"]
        helper_state = await api.request("GET", "/api/states/" + helper_entity)
        check(float(helper_state["state"]) == 31, "Selected HA helper and its value survived")
    check(snapshot["devices"]["fixture-device"]["notes"] == "Synthetic device note", "Device notes persisted")
    check(snapshot["rules"]["fixture-rule"]["completed_due_date"] == "2020-01-01", "Completion provenance persisted")
    check(snapshot["logs"], "Completion history persisted")
    check(snapshot["settings"]["battery_inventory"]["AA"] == 3, "Battery stock persisted")
    check(snapshot["settings"]["consumables"]["fixture-filter"]["quantity"] == 1.5, "Material stock persisted")
    panels = await api.ws({"type": "get_panels"})
    check("wartung" in panels and panels["wartung"]["require_admin"], "Admin-only panel registered")
    source = await api.request("GET", "/ha_wartung/panel.js")
    check("ha-wartung-panel" in source, "Bundled frontend is served")


async def bootstrap(session):
    anonymous = API(session)
    await wait_ready(anonymous)
    password = secrets.token_urlsafe(24)
    onboard = await anonymous.request("POST", "/api/onboarding/users", {
        "client_id": CLIENT, "name": "Release Test Owner", "username": "release-test-owner",
        "password": password, "language": "en",
    })
    grant = await token_grant(anonymous, {"grant_type": "authorization_code", "code": onboard["auth_code"]})
    token = grant["access_token"]
    api = API(session, token)
    await api.request("POST", "/api/onboarding/core_config", {})
    await api.request("POST", "/api/onboarding/analytics", {})
    await api.request("POST", "/api/onboarding/integration", {"client_id": CLIENT, "redirect_uri": CLIENT})
    entry_id = await configure(api)
    empty = await api.action("export")
    check(all(not empty[name] for name in ("devices", "rules", "logs", "shopping")), "Fresh installation has no household data")
    duplicate = await api.request("POST", "/api/config/config_entries/flow", {"handler": DOMAIN})
    check(duplicate["type"] == "abort" and duplicate["reason"] == "already_configured", "Singleton config flow")
    # Use real auth and public WebSocket handlers, never a mocked connection/user.
    user = await api.ws({"type": "config/auth/create", "name": "Release Test Viewer", "group_ids": ["system-users"]})
    await api.ws({"type": "config/auth_provider/homeassistant/create", "user_id": user["user"]["id"],
                  "username": "release-test-viewer", "password": password})
    login = await anonymous.request("POST", "/auth/login_flow", {
        "client_id": CLIENT, "handler": ["homeassistant", None], "redirect_uri": CLIENT,
    })
    login = await anonymous.request("POST", "/auth/login_flow/" + login["flow_id"], {
        "client_id": CLIENT, "username": "release-test-viewer", "password": password,
    })
    viewer = API(session, await access_token(anonymous, login["result"]))
    await viewer.ws({"type": DOMAIN + "/request", "action": "get", "payload": {}}, expect_error="unauthorized")
    await viewer.ws({"type": DOMAIN + "/request", "action": "save_device", "payload": {"value": {"name": "Must not be saved"}}}, expect_error="unauthorized")
    check(not (await api.action("export"))["devices"], "Rejected request did not mutate storage")
    helper = await api.ws({"type": "input_number/create", "name": "Release battery threshold", "min": 0,
                           "max": 100, "step": 1, "mode": "slider", "initial": 31})
    helper_entity = "input_number." + helper["id"]
    helper_state = await api.request("GET", "/api/states/" + helper_entity)
    check(float(helper_state["state"]) == 31, "Existing helper value preserved when selected")
    await api.mutate("save_device", value={"id": "fixture-device", "name": "Example appliance", "category": "Haushalt",
                                          "notes": "Synthetic device note", "battery_type": "AA", "battery_quantity": 2})
    await api.mutate("save_device", value={"id": "fixture-linked", "name": "Example controller", "category": "Smart Home",
                                          "related_devices": [{"id": "fixture-device"}]})
    await api.mutate("battery_inventory", stocks={"AA": 3}, thresholds={"AA": 1}, notes={"AA": "Synthetic battery note"})
    await api.mutate("save_consumable", value={"id": "fixture-filter", "name": "Example filter", "unit": "pieces",
                                              "quantity": 2.5, "threshold": 1, "notes": "Synthetic material note", "device_ids": ["fixture-device"]})
    await api.mutate("save_rule", value={"id": "fixture-rule", "device_id": "fixture-device", "name": "Replace filter",
                                        "kind": "date", "due_date": "2020-01-01",
                                        "consumable": {"kind": "material", "id": "fixture-filter", "quantity": 1}})
    revision = (await api.action("get", fields=["revision"]))["revision"]
    done = await api.action("complete", revision=revision, rule_id="fixture-rule", operation_id="fixture-completion",
                            event_date="2020-01-01", note="Replace filter", consume_material=True)
    retry = await api.action("complete", revision=revision, rule_id="fixture-rule", operation_id="fixture-completion",
                             event_date="2020-01-01", note="Replace filter", consume_material=True)
    check(done["id"] == retry["id"] and retry["already_saved"], "Idempotent completion retry")
    await api.ws({"type": DOMAIN + "/request", "action": "save_device", "payload": {
        "revision": revision, "value": {"id": "fixture-device", "name": "Stale update"}}}, expect_error="invalid_request")
    expected = await api.action("export")
    await assert_snapshot(api, expected)
    STATE.write_text(json.dumps({"token": token, "refresh_token": grant["refresh_token"],
                                 "entry_id": entry_id, "expected": expected,
                                 "username": "release-test-owner", "password": password, "helper_entity": helper_entity}))
    print("PASS: fresh install, real config flow, singleton, admin boundary, atomic completion, persisted fixture", flush=True)


async def lifecycle(session, phase):
    state = json.loads(STATE.read_text())
    api = await refresh_api(session, state)
    STATE.write_text(json.dumps(state))
    # Wait for integration startup after validating the persisted auth grant.
    for attempt in range(120):
        try:
            await api.action("get", fields=["revision"])
            break
        except AuthenticationError:
            raise
        except Exception:
            await asyncio.sleep(1)
    await assert_snapshot(api, state["expected"])
    if phase == "preferences":
        await api.mutate("preferences", value={"currency": "EUR", "battery_threshold_entity": state["helper_entity"]})
        state["expected"] = await api.action("export")
        await assert_snapshot(api, state["expected"])
        STATE.write_text(json.dumps(state))
    elif phase == "reload":
        response = await api.request("POST", "/api/config/config_entries/entry/" + state["entry_id"] + "/reload")
        check(response.get("require_restart") is False, f"Reload result: {response}")
        await assert_snapshot(api, state["expected"])
    elif phase == "reinstall":
        response = await api.request("DELETE", "/api/config/config_entries/entry/" + state["entry_id"])
        check(response.get("require_restart") is False, f"Removal result: {response}")
        await api.ws({"type": DOMAIN + "/request", "action": "get", "payload": {}}, expect_error="not_loaded")
        panels = await api.ws({"type": "get_panels"})
        check("wartung" not in panels, "Unloaded panel removed")
        state["entry_id"] = await configure(api)
        await assert_snapshot(api, state["expected"])
        STATE.write_text(json.dumps(state))
    print("PASS: " + phase + " preserves real stored devices, links, tasks, history and inventory", flush=True)


async def main():
    async with ClientSession(timeout=ClientTimeout(total=20)) as session:
        if sys.argv[1] == "bootstrap":
            await bootstrap(session)
        else:
            await lifecycle(session, sys.argv[1])


if __name__ == "__main__":
    asyncio.run(main())
