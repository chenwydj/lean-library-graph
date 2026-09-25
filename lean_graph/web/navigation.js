// Session-local node visits, shared by both diagram views. Filters and inline
// previews are not visits. Back/forward updates each view's last visited node.
export class NodeNavigation {
  entries = [];
  cursor = -1;
  last = {declarations:null, modules:null};

  visit(mode, id) {
    if (!id) return;
    this.last[mode] = id;
    const current = this.entries[this.cursor];
    if (current?.mode === mode && current.id === id) return;
    this.entries.splice(this.cursor + 1);
    this.entries.push({mode,id});
    this.cursor = this.entries.length - 1;
  }

  target(direction, current) {
    const entry = this.entries[this.cursor];
    const atEntry = entry?.mode === current.mode && entry?.id === current.id;
    // From an unselected overview, Back first returns to the latest node.
    const index = direction < 0 ? this.cursor - (atEntry ? 1 : 0) : this.cursor + 1;
    return index >= 0 && index < this.entries.length ? index : null;
  }

  move(direction, current) {
    const index = this.target(direction,current);
    if (index === null) return null;
    this.cursor = index;
    const entry = this.entries[index];
    this.last[entry.mode] = entry.id;
    return entry;
  }

  retain(isValid) {
    // A source refresh may remove nodes. Drop stale visits without selecting
    // a different node or moving the cursor into the forward history.
    const previous = this.entries;
    this.entries = previous.filter(isValid);
    this.cursor = previous.slice(0,this.cursor+1).filter(isValid).length - 1;
    for (const mode of Object.keys(this.last)) {
      if (this.last[mode] && !isValid({mode,id:this.last[mode]})) this.last[mode] = null;
    }
  }
}
