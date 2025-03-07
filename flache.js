import cleanQuery from "./helpers/cleanQuery";
import constructQueryChildren from "./helpers/constructQueryChildren";
import constructResponsePath from "./helpers/constructResponsePath";
import createCallbacksForPartialQueryValidation from "./helpers/createCallbacksForPartialQueryValidation";
import denormalize from "./helpers/denormalize";
import flatten from "./helpers/flatten";

export default class Flache {
  // TODO: have these parameters set-up on initialization rather than on each query
  constructor(fetcher, headers = { "Content-Type": "application/graphql" }, options) {
    this.cache = {};
    this.queryCache = {};
    this.fieldsCache = [];
    this.cacheLength = 0;
    this.cbs;
    // this.endpoint = endpoint;
    this.options = options;
    this.headers = headers;
    this.fetcher = fetcher;
  }

  /**
   * Saves all Flache data to browser session storage for cache persistence. Purges after 200 seconds.
   */
  saveToSessionStorage() {
    Object.keys(this).forEach(key =>
      sessionStorage.setItem(key, JSON.stringify(this[key]))
    );
    setTimeout(() => sessionStorage.clear(), 200000);
  }

  /**
   * Grabs any relevant Flache data from browser session storage.
   */
  readFromSessionStorage() {
    Object.keys(this).forEach(key => {
      if (sessionStorage.getItem(key))
        this[key] = JSON.parse(sessionStorage.getItem(key));
    });
  }

  it(query, variables) {
    // create a key to store the payloads in the cache
    this.queryParams = cleanQuery(query);

    // create a children array to check params
    this.children = constructQueryChildren(query);

    // if an identical query comes in return the cached result
    if (this.cache[query]) {
      console.log(`Flacheql hit on key: ${query}`);
      return new Promise(resolve => {
        resolve(this.cache[query]);
      });
    }

    // set boolean to check for partial queries, else skip straight to fetchData and return
    if (!this.options.paramRetrieval || !this.options.fieldRetrieval) return this.fetchData(query, variables);

    // returns an object of callback functions that check query validity using subset options
    if (!this.cbs) this.cbs = createCallbacksForPartialQueryValidation(this.options.subsets);

    // create a boolean to check if all queries are subsets of others
    let allParamsPass = false;

    // increment cache length
    this.cacheLength = Object.keys(this.cache).length;
    // if the developer specifies in App.jsx
    if (this.options.paramRetrieval) {
      let childrenMatch = false;
      // check if query children match
      childrenMatch = this.fieldsCache.some(obj => {
        let currentChildren = Object.values(obj)[0].children;
        return this.children.every(child => currentChildren.includes(child));
      });

      if (childrenMatch) {
          // no need to run partial query check on first query
        if (this.cacheLength > 0) {
          let currentMatchedQuery;
          for (let key in variables) {
            for (let query in this.queryCache[key]) {
              if (
                this.cbs[this.options.subsets[key]](
                  variables[key],
                  this.queryCache[key][query]
                )
              ) {
                // if the callback returns true, set the currentMatchedQuery to be the current query
                currentMatchedQuery = query;
              } else {
                continue;
              }
              for (let currentKey in this.queryCache) {
                // skip the first key since this is the one that just matched
                if (key === currentKey) continue;
                /* run the value on that query on each callback
                such that if the callback of the current symbol passes
                given the current query variable as the first argument,
                and the cached value on the current matched query key as the second,
                the queriesPass boolean is set to the return value of the callback */
                let rule = this.options.subsets[currentKey];
                let arg1 = variables[currentKey];
                let arg2 = this.queryCache[currentKey][currentMatchedQuery]
                let result = this.cbs[rule](arg1, arg2);
                if (result) {
                  allParamsPass = result;
                } else {
                  allParamsPass = false;
                  break;
                }
              }

              if (allParamsPass) {
                let pathToNodes = this.options.pathToNodes;

                let cached = JSON.parse(JSON.stringify(this.cache[currentMatchedQuery]));
                let { path, lastTerm } = constructResponsePath(
                  pathToNodes,
                  cached
                );

                for (let key in this.options.queryPaths) {
                  path[lastTerm] = path[lastTerm].filter(el => {
                    let { path, lastTerm } = constructResponsePath(
                      this.options.queryPaths[key],
                      el
                    );
                    return this.cbs[this.options.subsets[key]](
                      path[lastTerm],
                      variables[key]
                    );
                  });
                }

                for (let key in this.options.subsets) {
                  if (
                    this.options.subsets[key] === 'first' ||
                    this.options.subsets[key] === 'last' ||
                    this.options.subsets[key] === 'limit'
                  ) {
                    path[lastTerm] = path[lastTerm].slice(0, variables[key])
                  }
                }

                return new Promise((resolve, reject) => {
                  resolve(cached);
                });
              }

            }
          }
        }
      }
    }

    Object.keys(variables).forEach(queryVariable => {
      // if a key already exists on the query cache for that variable add a new key value pair to it, else create a new obj
      if (this.queryCache[queryVariable]) {
        this.queryCache[queryVariable][query] =
          variables[queryVariable];
      } else
        this.queryCache[queryVariable] = {
          [query]: variables[queryVariable]
        };
    });

    if (this.options.fieldRetrieval) {
      let filtered;
      let foundMatch = false;
      this.fieldsCache.forEach(node => {
        if (node.hasOwnProperty(this.queryParams)) {
          foundMatch = this.children.every(child => {
            return node[this.queryParams].children.includes(child);
          });
          if (foundMatch) {
            filtered = JSON.parse(JSON.stringify(node[this.queryParams].data));
            for (let key in filtered) {
              if (!this.children.some(child => key.includes(child))) {
                delete filtered[key];
              }
            }
          }
        }
      });

      if (foundMatch) {
        return new Promise(resolve => {
          filtered = denormalize(filtered);
          resolve(filtered);
        });
      }

    } else {
      //if partial retrieval is off, return cached object or fetchData
      if (this.cache[query]) {
        return new Promise(resolve => {
          return resolve(this.cache[query]);
        });
      } else {
        return this.fetchData(query, variables);
      }
    }
    return this.fetchData(query, variables);
  }

  fetchData(query, variables) {
    return this.fetcher(query, variables).then(res => {
      this.cache[query] = res;
      let normalizedData = flatten(res);
        this.fieldsCache.push({
          [this.queryParams]: {
            data: normalizedData,
            children: constructQueryChildren(query)
          }
        });
        return res;
      });
  }
}
