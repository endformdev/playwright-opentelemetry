# Trace Viewer Search Functionality Test Plan

## Application Overview

This test plan covers the search functionality within the Trace Viewer application. The search allows users to find spans by their names, attributes (key-value pairs), and other indexed fields like kind, title, and serviceName. The search uses fuzzy matching (uFuzzy) and displays results in a dropdown combobox. Tests cover basic search, attribute search, zoomed viewport states, result selection, and keyboard interactions.

## Test Scenarios

### 1. Basic Search Functionality

**Seed:** `tests/search/seed.spec.ts`

#### 1.1. should focus search input when clicking on search box

**File:** `tests/search/basic-search.spec.ts`

**Steps:**
  1. Load a trace with spans and external requests
  2. Click on the search combobox
  3. Verify the search input is focused

**Expected Results:**
  - Search combobox is visible in the header
  - Search input becomes active/focused after clicking
  - Keyboard shortcut hint (/) is hidden when focused

#### 1.2. should focus search input when pressing / key

**File:** `tests/search/basic-search.spec.ts`

**Steps:**
  1. Load a trace with spans
  2. Click somewhere on the timeline to ensure search is not focused
  3. Press the / key
  4. Verify the search input is focused

**Expected Results:**
  - Search combobox shows / keyboard hint when not focused
  - Pressing / focuses the search input
  - The / character is NOT typed into the input

#### 1.3. should display search results when typing a query

**File:** `tests/search/basic-search.spec.ts`

**Steps:**
  1. Load a trace with HTTP GET spans
  2. Click on the search combobox
  3. Type 'GET' into the search input
  4. Wait for search results to appear

**Expected Results:**
  - Search results dropdown opens after typing
  - Results show spans matching 'GET'
  - Each result displays the matched text and parent span title
  - Results count is shown if results exceed 50 items

#### 1.4. should show 'No results found' for queries with no matches

**File:** `tests/search/basic-search.spec.ts`

**Steps:**
  1. Load a trace with spans
  2. Click on the search combobox
  3. Type a non-existent query like 'zzzznonexistent'
  4. Observe the dropdown

**Expected Results:**
  - Dropdown shows 'No results found' message
  - No span results are displayed

#### 1.5. should clear search when clicking the clear button

**File:** `tests/search/basic-search.spec.ts`

**Steps:**
  1. Load a trace with spans
  2. Type a search query
  3. Click the clear (X) button that appears
  4. Verify search is cleared

**Expected Results:**
  - Clear button appears when there is search text
  - Clicking clear button empties the search input
  - Search results dropdown closes
  - Details panel returns to default state

#### 1.6. should close search dropdown when pressing Escape

**File:** `tests/search/basic-search.spec.ts`

**Steps:**
  1. Load a trace with spans
  2. Type a search query to open results dropdown
  3. Press the Escape key
  4. Verify dropdown closes

**Expected Results:**
  - Search results dropdown closes on Escape
  - Search text remains in the input
  - Search input may remain focused or blur depending on behavior

#### 1.7. should highlight matched text in search results

**File:** `tests/search/basic-search.spec.ts`

**Steps:**
  1. Load a trace with spans
  2. Type a specific search query like 'playwright.dev'
  3. Observe the search results

**Expected Results:**
  - Matched portions of text are highlighted with yellow background
  - Highlighting uses the fuzzy match ranges from uFuzzy

### 2. Search for Attributes in Spans

**Seed:** `tests/search/seed.spec.ts`

#### 2.1. should find spans by attribute value

**File:** `tests/search/attribute-search.spec.ts`

**Steps:**
  1. Load a trace with HTTP spans containing 'playwright.dev' in server.address
  2. Type 'playwright.dev' in the search
  3. Observe the search results

**Expected Results:**
  - Results show 'server.address: playwright.dev' format
  - Each result shows the parent span title (HTTP GET)
  - Multiple matches are returned for all spans with this attribute

#### 2.2. should find spans by attribute key

**File:** `tests/search/attribute-search.spec.ts`

**Steps:**
  1. Load a trace with spans containing http.request.method attribute
  2. Type 'request method' in the search (fuzzy match)
  3. Observe the search results

**Expected Results:**
  - Results show spans with http.request.method attribute
  - Fuzzy matching works for attribute keys with dots and underscores

#### 2.3. should find spans by special fields (kind, name, title)

**File:** `tests/search/attribute-search.spec.ts`

**Steps:**
  1. Load a trace with spans of different kinds
  2. Type 'internal' in the search
  3. Observe the search results

**Expected Results:**
  - Results show spans where kind is 'internal'
  - Results are displayed with just the value (not key: value format for special fields)

#### 2.4. should find test step spans by step name

**File:** `tests/search/attribute-search.spec.ts`

**Steps:**
  1. Load a trace with test steps
  2. Type 'Navigate' in the search
  3. Observe the search results

**Expected Results:**
  - Results include test steps with 'Navigate' in their title
  - Results show the full step title as matched text

#### 2.5. should perform fuzzy matching for typos

**File:** `tests/search/attribute-search.spec.ts`

**Steps:**
  1. Load a trace with spans
  2. Type a query with minor typos like 'playwrght' (missing 'i')
  3. Observe the search results

**Expected Results:**
  - Fuzzy matching finds results despite typo
  - Results show spans containing 'playwright'

#### 2.6. should limit results to maximum 50 and show count

**File:** `tests/search/attribute-search.spec.ts`

**Steps:**
  1. Load a trace with many spans (50+)
  2. Type a broad search query like 'GET'
  3. Scroll through results

**Expected Results:**
  - Maximum 50 results are displayed in the dropdown
  - Footer shows 'Showing 50 of N results' when there are more than 50 matches

### 3. Search in Zoomed In State

**Seed:** `tests/search/seed.spec.ts`

#### 3.1. should search and find spans while zoomed into timeline

**File:** `tests/search/zoomed-in-search.spec.ts`

**Steps:**
  1. Load a trace with spans
  2. Zoom into the timeline (click and drag to select a range)
  3. Perform a search for spans
  4. Verify search works regardless of zoom level

**Expected Results:**
  - Search returns all matching spans, not just visible ones
  - Results include spans outside the current viewport
  - Hovering results can show position indicator even if span is off-screen

#### 3.2. should show hover indicator when result span is visible

**File:** `tests/search/zoomed-in-search.spec.ts`

**Steps:**
  1. Load a trace and zoom into a specific time range
  2. Search for a span that exists within the zoomed range
  3. Hover over the search result

**Expected Results:**
  - Position indicator line appears at the span's start time
  - Details panel shows the hovered span's details
  - Span is highlighted in the timeline if visible

#### 3.3. should handle search result hover when span is outside viewport

**File:** `tests/search/zoomed-in-search.spec.ts`

**Steps:**
  1. Load a trace and zoom into a narrow time range at the beginning
  2. Search for a span that exists later in the trace (outside viewport)
  3. Hover over the search result

**Expected Results:**
  - Details panel shows the span information
  - Position indicator may not be visible if span start is off-screen
  - Timeline does not automatically scroll or pan to the span

#### 3.4. should maintain search results after zooming

**File:** `tests/search/zoomed-in-search.spec.ts`

**Steps:**
  1. Load a trace and perform a search
  2. While results are open, zoom the timeline
  3. Verify search results remain stable

**Expected Results:**
  - Search results remain displayed after zoom
  - Results are not re-filtered based on viewport
  - Selecting a result still works after zooming

### 4. Search in Zoomed Out State

**Seed:** `tests/search/seed.spec.ts`

#### 4.1. should search and find spans in zoomed out overview

**File:** `tests/search/zoomed-out-search.spec.ts`

**Steps:**
  1. Load a trace with spans
  2. Double-click to reset zoom to full trace view
  3. Perform a search for spans

**Expected Results:**
  - Search returns all matching spans
  - Full trace is visible in timeline
  - Search works identically to zoomed in state

#### 4.2. should show position indicator in full timeline view

**File:** `tests/search/zoomed-out-search.spec.ts`

**Steps:**
  1. Load a trace and reset to full view (double-click)
  2. Search for a span
  3. Hover over a search result

**Expected Results:**
  - Position indicator line appears at span's start time
  - Indicator is visible since full trace is in view
  - Details panel shows span information

#### 4.3. should find spans across entire trace duration

**File:** `tests/search/zoomed-out-search.spec.ts`

**Steps:**
  1. Load a trace with spans at beginning, middle, and end
  2. Reset to full view
  3. Search for a term that matches spans across the trace

**Expected Results:**
  - Results include spans from all parts of the trace
  - Results are ordered by search relevance, not by time

### 5. Selection of Search Results

**Seed:** `tests/search/seed.spec.ts`

#### 5.1. should select span when clicking on search result

**File:** `tests/search/result-selection.spec.ts`

**Steps:**
  1. Load a trace with spans
  2. Perform a search
  3. Click on a search result

**Expected Results:**
  - Search dropdown closes after selection
  - Timeline position locks to the selected span's start time
  - Position indicator changes from thin hover line to thick locked line
  - Details panel shows the selected span's information
  - Clear button appears in search input

#### 5.2. should select span when pressing Enter on highlighted result

**File:** `tests/search/result-selection.spec.ts`

**Steps:**
  1. Load a trace with spans
  2. Perform a search
  3. Use arrow keys to navigate to a result
  4. Press Enter to select

**Expected Results:**
  - Dropdown closes after Enter
  - Selected span is locked in details panel
  - Timeline shows locked position indicator

#### 5.3. should navigate through results with arrow keys

**File:** `tests/search/result-selection.spec.ts`

**Steps:**
  1. Load a trace with multiple matching spans
  2. Perform a search that returns multiple results
  3. Press ArrowDown to move through results
  4. Press ArrowUp to move backwards

**Expected Results:**
  - ArrowDown highlights next result
  - ArrowUp highlights previous result
  - Highlighted result shows hover state in details panel
  - Position indicator moves as navigation changes

#### 5.4. should update details panel when hovering search results

**File:** `tests/search/result-selection.spec.ts`

**Steps:**
  1. Load a trace with spans
  2. Perform a search
  3. Hover over different search results

**Expected Results:**
  - Details panel updates to show hovered span
  - Time indicator in header shows span's timestamp
  - Screenshot (if visible) corresponds to hover time

#### 5.5. should show span details with attributes on selection

**File:** `tests/search/result-selection.spec.ts`

**Steps:**
  1. Load a trace with HTTP spans
  2. Search for a specific HTTP request
  3. Click to select the result

**Expected Results:**
  - Details panel shows span title and duration
  - All attributes are displayed (http.request.method, url.full, etc.)
  - Kind is displayed (client, internal, etc.)
  - Time range is shown

#### 5.6. should unlock position when clicking on timeline after selection

**File:** `tests/search/result-selection.spec.ts`

**Steps:**
  1. Load a trace and select a search result (locking position)
  2. Click anywhere on the timeline
  3. Observe the position indicator behavior

**Expected Results:**
  - Locked position unlocks on timeline click
  - Position indicator returns to thin hover line
  - Details panel switches to hover mode

#### 5.7. should unlock position when pressing Escape after selection

**File:** `tests/search/result-selection.spec.ts`

**Steps:**
  1. Load a trace and select a search result (locking position)
  2. Press Escape key
  3. Observe the position indicator behavior

**Expected Results:**
  - Locked position unlocks on Escape
  - Details panel returns to hover mode

#### 5.8. should maintain locked state while hovering new search results

**File:** `tests/search/result-selection.spec.ts`

**Steps:**
  1. Load a trace and select a search result (locking position)
  2. Perform a new search without clearing
  3. Hover over new search results

**Expected Results:**
  - Locked position indicator remains visible (thick line)
  - A secondary hover indicator appears for new hover
  - Mode switches to 'search-override' showing both indicators
  - Details panel shows hovered span while maintaining lock

### 6. Search Edge Cases and Error Handling

**Seed:** `tests/search/seed.spec.ts`

#### 6.1. should handle empty search gracefully

**File:** `tests/search/edge-cases.spec.ts`

**Steps:**
  1. Load a trace with spans
  2. Focus the search input
  3. Submit empty search (just press Enter)

**Expected Results:**
  - No results are shown
  - Application does not crash
  - Dropdown remains closed

#### 6.2. should handle special characters in search

**File:** `tests/search/edge-cases.spec.ts`

**Steps:**
  1. Load a trace with spans
  2. Search for terms with special characters like '/' or ':' or '.'
  3. Observe search behavior

**Expected Results:**
  - Search handles special characters gracefully
  - Results include spans with matching special characters
  - No JavaScript errors occur

#### 6.3. should debounce search input

**File:** `tests/search/edge-cases.spec.ts`

**Steps:**
  1. Load a trace with spans
  2. Type rapidly into the search input
  3. Observe network/performance behavior

**Expected Results:**
  - Search is debounced (200ms delay before search executes)
  - Typing quickly does not cause excessive re-renders
  - Final search query is processed correctly

#### 6.4. should handle very long search queries

**File:** `tests/search/edge-cases.spec.ts`

**Steps:**
  1. Load a trace with spans
  2. Type a very long search query (100+ characters)
  3. Observe application behavior

**Expected Results:**
  - Application handles long queries without crashing
  - Search either finds results or shows 'no results'
  - UI remains responsive

#### 6.5. should handle search when no trace is loaded

**File:** `tests/search/edge-cases.spec.ts`

**Steps:**
  1. Navigate to application without loading a trace
  2. Attempt to use search if accessible

**Expected Results:**
  - Search is either disabled or handles gracefully
  - No errors when trace data is unavailable

#### 6.6. should preserve search text when switching between hover and locked modes

**File:** `tests/search/edge-cases.spec.ts`

**Steps:**
  1. Load a trace and perform a search
  2. Select a result (enters locked mode)
  3. Click on timeline (unlocks)
  4. Observe search input state

**Expected Results:**
  - Search text remains in input after mode changes
  - Clear button remains visible if text is present
  - Can immediately search again without re-typing

### 7. Search Integration with Timeline Panels

**Seed:** `tests/search/seed.spec.ts`

#### 7.1. should highlight matching spans in Steps Timeline

**File:** `tests/search/timeline-integration.spec.ts`

**Steps:**
  1. Load a trace with test steps
  2. Search for a step name
  3. Observe the Steps Timeline panel

**Expected Results:**
  - Matching spans in Steps Timeline are visually highlighted
  - Non-matching spans have reduced visibility
  - Highlighting updates as search query changes

#### 7.2. should highlight matching spans in External Spans panel

**File:** `tests/search/timeline-integration.spec.ts`

**Steps:**
  1. Load a trace with external HTTP spans
  2. Search for 'HTTP GET'
  3. Observe the External Spans panel

**Expected Results:**
  - Matching HTTP spans are highlighted
  - Search highlighting works across all timeline panels
  - Scrolling to see more spans maintains highlighting

#### 7.3. should scroll details panel to focused span on search result hover

**File:** `tests/search/timeline-integration.spec.ts`

**Steps:**
  1. Load a trace with many spans
  2. Perform a search
  3. Hover over a result that corresponds to a span not currently in view

**Expected Results:**
  - Details panel scrolls to show the hovered span
  - Span details card is visible after scroll
  - Focused span has visual indicator (ring or border)

#### 7.4. should navigate to parent span from search result

**File:** `tests/search/timeline-integration.spec.ts`

**Steps:**
  1. Load a trace with nested spans
  2. Search for a child span
  3. Select the result and observe details panel
  4. Click the 'Parent' navigation button

**Expected Results:**
  - Parent span details are shown after clicking parent button
  - Position remains locked
  - Navigation works within the locked state
