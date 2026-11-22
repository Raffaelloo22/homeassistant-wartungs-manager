"""UI setup; one household maintenance directory."""
import probatio as vol
from homeassistant.config_entries import ConfigFlow

class WartungConfigFlow(ConfigFlow, domain='ha_wartung'):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        await self.async_set_unique_id('household')
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(title='Wartungs-Manager', data={})
        return self.async_show_form(step_id='user', data_schema=vol.Schema({}))
