/** A name with its face in front, "🦊 Rina"; just the name for guests without one. */
export function who(name = "", avatar?: string) {
  return avatar ? `${avatar} ${name}` : name;
}
