# List Card

This card give you a table generated with data from the [feedparser custom component](https://github.com/custom-components/sensor.feedparser).\

## Options

| Name | Type | Requirement | Description
| ---- | ---- | ------- | -----------
| type | string | **Required** | `custom:list-card`
| entity | string | **Required** | The entity_id of the entity you want to show.
| title | string | **Optional** | Add a custom title to the card.
| columns | object | **Optional** | List of columns to display.

## Column object

| Name | Type | Requirement | Description
| title | string | **Required** | Column header to display.
| field | string **Required** | key values of the entity that you wish to display.
| type | string | **Optional** | options are `image` and `link`. Default is `text.
| style | object | **Optional** | CSS styles to apply to this column.


## Installation

### Step 1

Install `list-card` by copying `list-card.js`from this repo to `<config directory>/www/list-card.js` on your Home Assistant instanse.

**Example:**

```bash
wget https://raw.githubusercontent.com/custom-cards/list-card/master/list-card.js
mv list-card.js /config/www/
```

### Step 2

Link `list-card` inside you `ui-lovelace.yaml`.

```yaml
resources:
  - url: /local/list-card.js?v=0
    type: js
```

### Step 3

Add a custom element in your `ui-lovelace.yaml`

```yaml
      - type: custom:list-card
        entity: sensor.engineering_feed
```

![example](example.png)