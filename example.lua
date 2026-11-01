-- Catalog Sniper example for Roblox script.
-- Running this file loads the first page of emotes. Use the methods below
-- to connect your existing UI controls to the API.

local HttpService = game:GetService("HttpService")

local API_BASE_URL = "https://catalog-sniper.vercel.app"
local DATASET_ROUTES = {
    emotes = "/api/emotes",
    animations = "/api/animation",
    moods = "/api/moods",
}
local ALLOWED_LIMITS = {
    [25] = true,
    [50] = true,
    [100] = true,
    [200] = true,
}
local SEARCH_DEBOUNCE_SECONDS = 0.25
local MAX_CACHED_PAGES = 64

local function normalizeQuery(query)
    query = string.lower(tostring(query or ""))
    query = string.gsub(query, "%s+", " ")
    return string.match(query, "^%s*(.-)%s*$")
end

local function httpGet(url)
    local gameHttpOk, gameHttpResult = pcall(function()
        return game:HttpGet(url)
    end)
    if gameHttpOk and type(gameHttpResult) == "string" then
        return gameHttpResult
    end

    local requestFunction = request or http_request
    if type(requestFunction) == "function" then
        local response = requestFunction({
            Url = url,
            Method = "GET",
        })
        if type(response) ~= "table" then
            error("Executor returned an invalid HTTP response")
        end

        local statusCode = tonumber(response.StatusCode or response.Status)
        if response.Success == false or (statusCode and (statusCode < 200 or statusCode >= 300)) then
            error("Catalog API returned HTTP " .. tostring(statusCode or "error"))
        end
        local body = response.Body or response.body
        if type(body) ~= "string" then
            error("Executor response did not include a text body")
        end
        return body
    end

    error(
        "This executor does not expose game:HttpGet, request, or http_request. " ..
        "Use an executor with HTTP request support."
    )
end

local function fetchPage(dataset, query, page, limit)
    local route = DATASET_ROUTES[dataset]
    assert(route, "Dataset must be emotes, animations, or moods")
    assert(type(page) == "number" and page >= 1 and page % 1 == 0, "Page must be a positive integer")
    assert(ALLOWED_LIMITS[limit], "Limit must be 25, 50, 100, or 200")

    local url = string.format(
        "%s%s?page=%d&limit=%d&search=%s",
        API_BASE_URL,
        route,
        page,
        limit,
        HttpService:UrlEncode(query or "")
    )
    local response = HttpService:JSONDecode(httpGet(url))
    if type(response) ~= "table" or type(response.data) ~= "table" or type(response.pagination) ~= "table" then
        error("Catalog API returned an invalid response")
    end
    return response
end

local Browser = {}
Browser.__index = Browser

function Browser.new(options)
    options = options or {}
    local self = setmetatable({
        dataset = options.dataset or "emotes",
        query = "",
        page = 1,
        limit = options.limit or 50,
        callbacks = options.callbacks or {},
        cache = {},
        cacheOrder = {},
        requestId = 0,
        searchId = 0,
        debounceThread = nil,
    }, Browser)

    assert(DATASET_ROUTES[self.dataset], "Dataset must be emotes, animations, or moods")
    assert(ALLOWED_LIMITS[self.limit], "Limit must be 25, 50, 100, or 200")
    self:loadPage()
    return self
end

function Browser:cacheKey(page)
    return table.concat({
        self.dataset,
        normalizeQuery(self.query),
        tostring(page or self.page),
        tostring(self.limit),
    }, "\0")
end

function Browser:getCachedPage(key)
    local cached = self.cache[key]
    if not cached then
        return nil
    end
    for index, existingKey in ipairs(self.cacheOrder) do
        if existingKey == key then
            table.remove(self.cacheOrder, index)
            break
        end
    end
    table.insert(self.cacheOrder, key)
    return cached
end

function Browser:cachePage(key, response)
    if not self.cache[key] then
        table.insert(self.cacheOrder, key)
    else
        self:getCachedPage(key)
    end
    self.cache[key] = response
    if #self.cacheOrder > MAX_CACHED_PAGES then
        local oldestKey = table.remove(self.cacheOrder, 1)
        self.cache[oldestKey] = nil
    end
end

function Browser:setLoading(isLoading)
    if self.callbacks.onLoading then
        self.callbacks.onLoading(isLoading)
    end
end

function Browser:cancelDebounce()
    self.searchId += 1
    if self.debounceThread then
        task.cancel(self.debounceThread)
        self.debounceThread = nil
    end
end

function Browser:loadPage()
    self.requestId += 1
    local requestId = self.requestId
    local dataset = self.dataset
    local query = self.query
    local page = self.page
    local limit = self.limit
    local key = self:cacheKey(page)
    local cached = self:getCachedPage(key)

    if cached then
        self:setLoading(false)
        if self.callbacks.onData then
            self.callbacks.onData(cached.data, cached.pagination)
        end
        return
    end

    self:setLoading(true)
    task.spawn(function()
        local ok, response = pcall(fetchPage, dataset, query, page, limit)
        if requestId ~= self.requestId then
            return
        end
        if not ok then
            self:setLoading(false)
            if self.callbacks.onError then
                self.callbacks.onError(tostring(response))
            else
                warn(tostring(response))
            end
            return
        end

        self:cachePage(key, response)
        self:setLoading(false)
        if self.callbacks.onData then
            -- Only this page is passed to the UI; do not render the full catalog.
            self.callbacks.onData(response.data, response.pagination)
        end
    end)
end

function Browser:setDataset(dataset)
    assert(DATASET_ROUTES[dataset], "Dataset must be emotes, animations, or moods")
    self:cancelDebounce()
    self.dataset = dataset
    self.page = 1
    self:loadPage()
end

function Browser:setSearch(query)
    self.query = tostring(query or "")
    self.page = 1
    self:cancelDebounce()
    self.searchId += 1
    local searchId = self.searchId
    self.requestId += 1 -- Ignore any in-flight response for the previous query.
    self:setLoading(true)

    self.debounceThread = task.delay(SEARCH_DEBOUNCE_SECONDS, function()
        if searchId == self.searchId then
            self.debounceThread = nil
            self:loadPage()
        end
    end)
end

function Browser:setPage(page)
    assert(type(page) == "number" and page >= 1 and page % 1 == 0, "Page must be a positive integer")
    if page == self.page then
        return
    end
    self:cancelDebounce()
    self.page = page
    self:loadPage()
end

function Browser:setLimit(limit)
    assert(ALLOWED_LIMITS[limit], "Limit must be 25, 50, 100, or 200")
    if limit == self.limit then
        return
    end
    self:cancelDebounce()
    self.limit = limit
    self.page = 1
    self:loadPage()
end

function Browser:destroy()
    self.requestId += 1
    self:cancelDebounce()
end

-- Replace these callbacks with your existing UI's loading, error, and row
-- rendering functions. The constructor requests the first page immediately.
local browser = Browser.new({
    dataset = "emotes",
    limit = 50,
    callbacks = {
        onLoading = function(isLoading)
            print(isLoading and "Loading catalog..." or "Catalog loaded.")
        end,
        onError = function(message)
            warn("Catalog request failed: " .. message)
        end,
        onData = function(records, pagination)
            print(string.format(
                "%s | page %d | %d results | %d total",
                "Emotes",
                pagination.page,
                #records,
                pagination.total
            ))
            for _, record in ipairs(records) do
                print(record.id, record.name, record.description or "")
                -- Reuse/refresh your existing UI row here.
            end
        end,
    },
})

-- Connect your existing UI controls to these methods:
-- browser:setSearch(searchTextBox.Text) -- debounced; resets to page 1
-- browser:setPage(2)                    -- request another page
-- browser:setLimit(100)                 -- 25, 50, 100, or 200; resets to page 1
-- browser:setDataset("animations")      -- emotes, animations, or moods
-- browser:destroy()                     -- call when closing the UI
