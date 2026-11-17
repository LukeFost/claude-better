# Design: discuss and edit the improved prompt in a pane

Status: proposal, 2026-11-17. Nothing here is built. Written against claude-better 0.4.9.

## What it is for

Today `/better` hands over one finished prompt. If it is nearly right, the only ways to change it are to edit it in the input box or run `/better` again from scratch. The idea: keep the helper around as a side thread, show its prompt in a pane beside the chat, let Luke and the helper both change it there, and send it to the main thread with one press.

## What a run looks like

1. `/better <rough prompt>` starts the helper as before.
2. When the helper answers, a pane opens beside the chat titled "/better draft". It shows the improved prompt as formatted text (headings, lists, code), the way a reply is drawn.
3. Under the draft are three controls:
   - **Edit** swaps the formatted view for a text box holding the same prompt. **Done** swaps back.
   - **Ask for a change** is a one-line box. What Luke types goes to the helper thread ("drop the wait-for-me gate", "why did you add step 4?"). The helper replies with a new draft, a short answer, or both. The pane shows the answer above the draft and replaces the draft if it changed.
   - **Send to thread** submits the draft to the main thread as the next prompt, closes the pane, and ends the helper thread.
4. **Put in input box** stays as a second button, for when Luke wants to finish it by hand. **Drop** closes the pane and discards the draft.

If the session is not on screen, no pane can be placed. Then 0.4.8's behaviour applies unchanged: copy, save the `.md`, log the prompt, wait for `/better-back`.

## Luke's notes from the probe, and what answers each

| Note | Answer |
| --- | --- |
| Enter does nothing visible; Shift+Enter adds a line; needs a hint | A dim line under the edit box: "Enter saves, Shift+Enter adds a line". Enter in the edit box means Done, not send, so a stray Enter never submits a prompt. |
| Should look like the Claude docs view, not a plain input box | Default view is the formatted `Markdown` element. The plain box appears only while editing. A pane has no element that is both formatted and editable, so this toggle is the closest fit. |
| The agent should edit it with us and add comments | "Ask for a change" sends Luke's request to the helper thread, which answers with a revised draft. Its notes are shown as a short list above the draft ("Changed: removed the gate in step 2"). Comments pinned to a line of the draft are not possible with the pane's elements; notes are per revision. |
| Clicking send did nothing | The probe's send only moved a counter. Here every press has a visible result: the pane closes with a toast on send, and shows "Asking the helper..." while a change is pending. |

## What the probe proved (desktop app, 2026-11-17)

- A plugin pane opens beside the chat when the session is on screen, and is refused with `no-surface` when it is not.
- A text box with `rows` shows multi-line text; every edit and the full text on Enter reach the plugin, blank lines kept.
- A button press in the pane reaches the plugin.
- A helper thread that has finished wakes on a new message, and the plugin receives its reply.

## Not proven

- The `Markdown` element in a pane. It is in the API (links, tables, code fences); I have not seen it drawn on desktop.
- Sending the draft as a prompt from a button press. `$.prompt.submit` exists; `/better` has only used `$.prompt.fill`.
- Ending the helper thread. I found no call that archives or closes an agent. It may be enough to stop messaging it; how it then shows in the tasks list is unknown.
- The pane in the terminal and on mobile. Only desktop was tried.
- How long a finished helper thread stays wakeable, and whether it survives an app restart.

## Rules that must hold

- The prompt is never sent on its own. Only a press on **Send to thread** submits it.
- The helper stays read-only. "Ask for a change" messages the same guarded helper; it gains no tools.
- One draft at a time. A second `/better` while a draft is open asks to replace it.
- The text box must not redraw on every keystroke. The probe did (460 redraws for 460 keys); the edit is kept in the plugin and the pane redraws on Done.
- The run record gains the revisions: how many changes were asked, and whether the prompt was sent, put in the box, or dropped.

## Size and order

1. Pane with the formatted draft, Edit/Done, Send to thread, Put in input box, Drop. Falls back to today's handover with no pane. About a day, with tests. This alone covers "see it, edit it, send it".
2. Ask for a change, with helper notes. About a day. Depends on the helper thread being the in-session fork; the `claude -p` helper cannot be woken, so that path would start a new helper with the draft and the request.
3. Record changes and README.

Step 1 first, used for a few days, before step 2. That fits the plan to measure before changing the helper prompt: the pane does not change what the helper writes.

## Open questions for Luke

- Should **Send to thread** submit at once, or fill the input box so Enter is still his? This design submits, because the pane is already the review step.
- Should the pane open on every `/better`, or only when asked (`/better-edit`)? This design opens it every time when a pane can be placed.
