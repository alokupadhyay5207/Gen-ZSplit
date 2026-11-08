"use client";

import {
  addMemberAction,
  createGroupAction,
  deleteGroupAction,
  joinGroupAction,
} from "@/actions/groups";
import { ActionForm, GzSubmit } from "./action-form";
import { CloseModalButton, Modal, ModalHead } from "./modal";
import { PasswordField } from "./small";

export function CreateGroupDialog({ currencies, symbols }: { currencies: string[]; symbols: Record<string, string> }) {
  return (
    <Modal id="create-modal">
      <ActionForm className="gz-modal-form" action={createGroupAction}>
        <ModalHead id="create-modal" title="Create a group" sub="You become the owner and can add or remove people." />
        <div className="gz-modal-body">
          <div className="gz-field">
            <label className="gz-label" htmlFor="cg-name">
              Group name
            </label>
            <input className="gz-input" id="cg-name" name="name" data-autofocus required minLength={2} maxLength={60} placeholder="Goa trip" autoComplete="off" />
          </div>
          <div className="gz-field">
            <label className="gz-label" htmlFor="cg-desc">
              Description <span className="gz-faint">(optional)</span>
            </label>
            <textarea className="gz-textarea" id="cg-desc" name="description" maxLength={280} rows={2} placeholder="Who is this for?" />
          </div>
          <div className="gz-field">
            <span className="gz-label" id="cg-cur-label">
              Currency
            </span>
            <div className="gz-seg gz-seg--wrap" role="radiogroup" aria-labelledby="cg-cur-label">
              {currencies.map((code, i) => (
                <label key={code}>
                  <input type="radio" name="currency" value={code} defaultChecked={i === 0} />
                  <span>
                    {symbols[code] !== code ? `${symbols[code]} ` : ""}
                    {code}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="gz-field">
            <label className="gz-label" htmlFor="cg-pw">
              Group password
            </label>
            <PasswordField id="cg-pw" name="password" minLength={6} maxLength={128} autoComplete="new-password" placeholder="At least 6 characters" />
            <p className="gz-hint">People join with the invite code plus this password. Share both only with people you trust.</p>
          </div>
        </div>
        <footer className="gz-modal-foot">
          <CloseModalButton className="gz-btn gz-btn--ghost">Cancel</CloseModalButton>
          <GzSubmit className="gz-btn gz-btn--primary">Create group</GzSubmit>
        </footer>
      </ActionForm>
    </Modal>
  );
}

export function JoinGroupDialog() {
  return (
    <Modal id="join-modal">
      <ActionForm className="gz-modal-form" action={joinGroupAction}>
        <ModalHead id="join-modal" title="Join a group" sub="Ask the group owner for the invite code and password." />
        <div className="gz-modal-body">
          <div className="gz-field">
            <label className="gz-label" htmlFor="jg-code">
              Invite code
            </label>
            <input
              className="gz-input gz-code-input"
              id="jg-code"
              name="code"
              data-autofocus
              required
              maxLength={9}
              placeholder="ABCD-EFGH"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
          </div>
          <div className="gz-field">
            <label className="gz-label" htmlFor="jg-pw">
              Group password
            </label>
            <PasswordField id="jg-pw" name="password" autoComplete="off" />
          </div>
        </div>
        <footer className="gz-modal-foot">
          <CloseModalButton className="gz-btn gz-btn--ghost">Cancel</CloseModalButton>
          <GzSubmit className="gz-btn gz-btn--primary">Join group</GzSubmit>
        </footer>
      </ActionForm>
    </Modal>
  );
}

export function AddMemberDialog({ groupId }: { groupId: number }) {
  return (
    <Modal id="member-modal">
      <ActionForm className="gz-modal-form" action={(fd) => addMemberAction(groupId, fd)}>
        <ModalHead id="member-modal" title="Add someone" sub="They need a Gen-ZSplit account with this email." />
        <div className="gz-modal-body">
          <div className="gz-field">
            <label className="gz-label" htmlFor="am-email">
              Email address
            </label>
            <input className="gz-input" id="am-email" type="email" name="email" data-autofocus required maxLength={254} placeholder="friend@example.com" autoComplete="off" />
            <p className="gz-hint">No account yet? Share the invite code and group password instead.</p>
          </div>
        </div>
        <footer className="gz-modal-foot">
          <CloseModalButton className="gz-btn gz-btn--ghost">Cancel</CloseModalButton>
          <GzSubmit className="gz-btn gz-btn--primary">Add to group</GzSubmit>
        </footer>
      </ActionForm>
    </Modal>
  );
}

export function DeleteGroupDialog({ groupId, groupName }: { groupId: number; groupName: string }) {
  return (
    <Modal id="delete-modal">
      <ActionForm className="gz-modal-form" action={(fd) => deleteGroupAction(groupId, fd)}>
        <ModalHead id="delete-modal" title="Delete this group?" sub="This cannot be undone." />
        <div className="gz-modal-body">
          <div className="gz-field">
            <label className="gz-label" htmlFor="dg-name">
              Type <strong>{groupName}</strong> to confirm
            </label>
            <input className="gz-input" id="dg-name" name="confirm_name" data-autofocus required autoComplete="off" placeholder={groupName} />
          </div>
        </div>
        <footer className="gz-modal-foot">
          <CloseModalButton className="gz-btn gz-btn--ghost">Keep group</CloseModalButton>
          <GzSubmit className="gz-btn gz-btn--danger">Delete forever</GzSubmit>
        </footer>
      </ActionForm>
    </Modal>
  );
}
