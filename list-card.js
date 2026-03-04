console.log(`%clist-card\n%cVersion: ${'0.1.6'}`, 'color: #EED202; font-weight: bold;background-color: black;', '');

class ListCard extends HTMLElement {

    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
    }

    setConfig(config) {
      if (!config.entity) {
        throw new Error('Please define an entity');
      }      

      const root = this.shadowRoot;
      if (root.lastChild) root.removeChild(root.lastChild);
      const cardConfig = Object.assign({}, config);

            // if no columns are specifically specified and it's a file_list from the folder integration
            if (config.feed_attribute && config.feed_attribute == "file_list" && (!cardConfig.columns || cardConfig.columns.length === 0)) {
              cardConfig.columns = [
                { title: "Path", field: "path" },
                { title: "Name", field: "name" },
                { title: "Filename", field: "filename" },
                { title: "Full Path", field: "fullpath", add_link: "fullpath" },
                { title: "Ext", field: "ext" }
              ];
            }
      
      const columns = cardConfig.columns;
      const card = document.createElement('ha-card');
      const content = document.createElement('div');
      const style = document.createElement('style');
      style.textContent = `
            ha-card {
              width: 100%;
            }
            
            .grid-container {
              display: grid;
              grid-template-columns: repeat(${columns.length}, minmax(100px, 1fr));   
              gap: 8px;
              padding: 16px;
              overflow-y:auto;
              max-height: 300px;
            }          
            .grid-row {
                display: contents;
            }        
            .grid-header {
              font-weight: bold;
              text-align: center; /* Center the header text */
            }           
            .grid-cell {
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              user-select: text;
              -webkit-user-select: text;
              -moz-user-select: text;
              -ms-user-select: text;
            }
            .actionable {
              cursor: pointer;
            }
          `;

      // Go through columns and add CSS styling to each column that is defined with the style tag, 
      // the css class will be the field name of the column.
      if (columns) {
        for (let column in columns) {
          if (columns.hasOwnProperty(column) && columns[column]) {
            if (columns[column]['style']) {
              let styles = columns[column]['style'];

              style.textContent += `
                .${columns[column].field} {`;

              for (let index in styles) {
                if (styles.hasOwnProperty(index)) {
                  for (let s in styles[index]) {
                    style.textContent += `
                    ${s}: ${styles[index][s]};`;
                  }
                }
              }

              style.textContent += `}`;
            }
          }
        }
      }

      content.id = "container";
      cardConfig.title ? card.header = cardConfig.title : null;

      card.appendChild(content);
      card.appendChild(style);
      root.appendChild(card);

      this._config = cardConfig;
    }

    transformFeed(oldFeed) {
      return oldFeed.map(file => {
        const path = file.substring(0, file.lastIndexOf('/') + 1);
        const filenameParts = file.split('/').pop().split('.');
        const filename = filenameParts[0];
        const extension = filenameParts[filenameParts.length - 1];
    
        // Check if the filename matches the expected format (YYYYMMDDHHmmSS)
        const filenameFormat = /^\d{14}$/;
    
        if (filenameFormat.test(filename)) {
          const fileDate = new Date(filename.slice(0, 4) + '-' + filename.slice(4, 6) + '-' + filename.slice(6, 8) + 'T' + filename.slice(8, 10) + ':' + filename.slice(10, 12) + ':' + filename.slice(12));
          const formattedDate = fileDate.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true });
    
          return {
            path: path,
            name: formattedDate,
            filename: filename + "." + extension,
            fullpath: path + filename + "." + extension,
            ext: extension
          };
        } else {
          return {
            path: path,
            name: filename,
            filename: filename + "." + extension,
            fullpath: path + filename + "." + extension,
            ext: extension
          };
        }
      });
    }

    set hass(hass) {
      const config = this._config;
      const root = this.shadowRoot;
      const card = root.lastChild;

      if (hass && hass.states[config.entity]) {
        const oldFeed = config.feed_attribute ? hass.states[config.entity].attributes[config.feed_attribute] : hass.states[config.entity].attributes;
        const feed = config.feed_attribute && config.feed_attribute == "file_list" ? this.transformFeed(oldFeed) : oldFeed;

        const columns = config.columns;
        this.style.display = 'block';
        const rowLimit = config.row_limit ? config.row_limit : Object.keys(feed).length;
        let rows = 0;

        if (feed !== undefined && Object.keys(feed).length > 0) {
          let card_content = '<div class="grid-container">';
        
          // Generate the header row
          const showHeader = config.show_header !== false;
          if (columns && showHeader) {
            card_content += '<div class="grid-row">';
            for (let column in columns) {
              if (columns.hasOwnProperty(column)) {
                card_content += `<div class="grid-cell grid-header ${columns[column].field}">${columns[column].title}</div>`;
              }
            }
            card_content += '</div>';
          }
        
          // allow sorting on the fields
          // Sort the feed based on the specified column
          if (config.sort) {
            if (!config.sort.value) {
              throw new Error(`You need to specify a value to sort on`);
            }
            const sortField = config.sort.value;
            const isReverse = config.sort.reverse || false;
          
            feed.sort((a, b) => {
              const valueA = a[sortField];
              const valueB = b[sortField];

              if (valueA < valueB) {
                return isReverse ? 1 : -1;
              }
              if (valueA > valueB) {
                return isReverse ? -1 : 1;
              }
              return 0;
            });
          }

          // Generate the data rows
          for (let entry in feed) {
            if (rows >= rowLimit) break;
        
            if (feed.hasOwnProperty(entry)) {
              let has_field = true;
        
              if (columns) {
                for (let column in columns) {
                  if (!feed[entry].hasOwnProperty(columns[column].field)) {
                    has_field = false;
                    break;
                  }
                }
              }
        
              if (!has_field) continue;     
              card_content += '<div class="grid-row">';
              if (columns) {
                for (let column in columns) {
                  if (columns.hasOwnProperty(column) && feed[entry].hasOwnProperty(columns[column].field)) {
                    const tapAction = columns[column].tap_action;
                    const holdAction = columns[column].hold_action;
                    const doubleTapAction = columns[column].double_tap_action;
                    
                    // added field for row data so we can retrieve it on action call
                    card_content += `<div class="grid-cell ${columns[column].field}${tapAction || holdAction || doubleTapAction ? ' actionable' : ''}" 
                    ${tapAction || holdAction || doubleTapAction ? `data-listcardID='${JSON.stringify(feed[entry])}'` : ''}
                    ${tapAction ? `data-tap-action='${JSON.stringify(tapAction)}'` : ''}
                    ${holdAction ? `data-hold-action='${JSON.stringify(holdAction)}'` : ''}
                    ${doubleTapAction ? `data-double-tap-action='${JSON.stringify(doubleTapAction)}'` : ''}>`;
                                                                           
                    // added .replace('config/www','local') so you can open files in the ha www folder with add_link
                    if (columns[column].hasOwnProperty('add_link')) {
                      card_content += `<a href="${feed[entry][columns[column].add_link].replace('config/www','local')}" target='_blank'>`;
                    }
        
                    if (columns[column].hasOwnProperty('type')) {
                      if (columns[column].type === 'image') {
                        let image_width = columns[column].width || 70;
                        let image_height = columns[column].height || 90;
                        let url = feed[entry][columns[column].field][0]?.url || feed[entry][columns[column].field];
                        card_content += `<img id="image" src="${url}" width="${image_width}" height="${image_height}">`;
                      } else if (columns[column].type === 'icon') {
                        card_content += `<ha-icon class="column-${columns[column].field}" icon=${feed[entry][columns[column].field]}></ha-icon>`;
                      }
                    } else {
                      let newText = feed[entry][columns[column].field];
        
                      if (columns[column].hasOwnProperty('regex')) {
                        newText = new RegExp(columns[column].regex, 'u').exec(feed[entry][columns[column].field]);
                      }
                      if (columns[column].hasOwnProperty('prefix')) {
                        newText = columns[column].prefix + newText;
                      }
                      if (columns[column].hasOwnProperty('postfix')) {
                        newText += columns[column].postfix;
                      }
        
                      card_content += `<span>${newText}</span>`;
                    }
        
                    if (columns[column].hasOwnProperty('add_link')) {
                      card_content += '</a>';
                    }
        
                    card_content += '</div>';
                  }
                }
              }
              card_content += '</div>';        
              ++rows;
            }
          }
        
          root.lastChild.hass = hass;
          card_content += '</div>';
          root.getElementById('container').innerHTML = card_content;
          

          // Add event listeners for tap_action, hold_action, and double_tap_action
          const cells = root.querySelectorAll('.grid-cell');
          cells.forEach(cell => {
            const tapAction = cell.getAttribute('data-tap-action');
            const holdAction = cell.getAttribute('data-hold-action');
            const doubleTapAction = cell.getAttribute('data-double-tap-action');
            const listcardID = cell.getAttribute('data-listcardID');

            if (tapAction) {
              cell.addEventListener('click', () => {
                this.handleAction(hass, JSON.parse(tapAction), listcardID);
              });
            }

            if (holdAction) {
              let timer = null;
              cell.addEventListener('touchstart', () => {
                timer = setTimeout(() => {
                  this.handleAction(hass, JSON.parse(holdAction), listcardID);
                }, 500);
              });
              cell.addEventListener('touchend', () => {
                clearTimeout(timer);
              });
            }

            if (doubleTapAction) {
              cell.addEventListener('dblclick', () => {
                this.handleAction(hass, JSON.parse(doubleTapAction), listcardID);
              });
            }
          });

        } else {
          this.style.display = 'none';
        }
      } else {
        this.style.display = 'none';
      }
    }     


                        // added logic to allow users to send '[[fieldname]]' in tap_action events
                        handleAction = (hass, action, listcardID) => {
                          if (action && action.action) {
                            // Replace placeholders in action data
                            const row = JSON.parse(listcardID);
                            action = this.replacePlaceholdersInAction(action, row); 
                    
                            switch (action.action) {
                              case 'call-service':
                              case 'navigate':
                              case 'fire-dom-event':

                              const actionConfig = {
                                tap_action: action
                                };
                                
                                const event = new Event("hass-action", {
                                  bubbles: true,
                                  composed: true,
                                });
                                event.detail = {
                                  config: actionConfig,
                                  action: "tap",
                                };
                                this.dispatchEvent(event);
                                break;
                              default:
                                console.warn('Unsupported action type:', action.action);
                            }
                          } else {
                            console.warn('Invalid action object:', action);
                          }
                        }
                    
                        replacePlaceholdersInAction = (action, row) => {
                          // Recursively traverse the action object
                          const traverse = (obj) => {
                              for (const key in obj) {
                                  if (typeof obj[key] === 'string') {
                                      // Check if the value is a string
                                      let replacedString = obj[key];
                                      const placeholders = replacedString.match(/\[\[(.*?)\]\]/g);
                                      if (placeholders) {
                                          // Replace each placeholder with the actual value from data
                                          placeholders.forEach(placeholder => {
                                              const field = placeholder.substring(2, placeholder.length - 2); // Extract the field name
                                              // Find the row with matching listcardID
                                              // Check if the field exists in the row
                                              if (row && row.hasOwnProperty(field)) {
                                                  // Replace the placeholder with the field data
                                                  replacedString = replacedString.replace(placeholder, row[field]);
                                              } else {
                                                  // Throw an error if the field doesn't match any of ours
                                                  throw new Error(`Invalid field '${field}' specified in action: ${JSON.stringify(action)}`);
                                              }
                                          });
                                          // Update the value of the object key with the replaced string
                                          obj[key] = replacedString;
                                      }
                                  } else if (typeof obj[key] === 'object') {
                                      // If the value is an object, recursively traverse it
                                      traverse(obj[key]);
                                  }
                              }
                          };
                      
                          // Start traversal from the top-level action object
                          traverse(action);
                          return action;
                      }
                      

    getCardSize() {
      return 1;
    }
  }

  customElements.define('list-card', ListCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "list-card",
  name: "List Card",
  preview: false,
  description: "The List Card generate a grid with data from sensor that provides data as a list of attributes. It will also handle the file_list attribute from the folder integration."
});
