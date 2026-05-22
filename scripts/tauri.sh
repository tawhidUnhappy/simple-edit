#!/usr/bin/env bash
# VS Code snap injects its own GTK/GDK/GIO environment variables pointing to
# snap core20 (glibc 2.31) library paths. Loading those causes a fatal
# symbol lookup error against the system glibc (2.34+). Unset them all so
# GTK falls back to system libraries.
unset LD_LIBRARY_PATH \
      GTK_EXE_PREFIX \
      GTK_PATH \
      GDK_PIXBUF_MODULE_FILE \
      GDK_PIXBUF_MODULEDIR \
      GIO_MODULE_DIR \
      GTK_IM_MODULE_FILE
exec tauri "$@"
