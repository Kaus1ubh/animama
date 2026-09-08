/*
 * Keep PyInstaller's mixed code/data tree intact under Resources. The .app's
 * MacOS directory contains only this native launcher, so resource signatures
 * never depend on extended attributes that the pack archive cannot preserve.
 * Every Mach-O in the payload is signed and verified separately by the producer
 * and installer; the outer app seal also covers the complete payload bytes.
 */
#include <errno.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
    (void)argc;
    char executable[PATH_MAX], resolved[PATH_MAX], payload[PATH_MAX];
    uint32_t capacity = sizeof(executable);
    if (_NSGetExecutablePath(executable, &capacity) != 0 ||
        realpath(executable, resolved) == NULL) {
        fputs("Animama document worker: cannot locate launcher\n", stderr);
        return 126;
    }
    char *component = strrchr(resolved, '/');
    if (component == NULL) return 126;
    *component = '\0';
    component = strrchr(resolved, '/');
    if (component == NULL || strcmp(component, "/MacOS") != 0) {
        fputs("Animama document worker: invalid bundle layout\n", stderr);
        return 126;
    }
    *component = '\0';
    component = strrchr(resolved, '/');
    if (component == NULL || strcmp(component, "/Contents") != 0) return 126;
    int length = snprintf(payload, sizeof(payload),
                          "%s/Resources/document-worker/animama-document-worker", resolved);
    if (length < 0 || (size_t)length >= sizeof(payload)) return 126;

    /* exec preserves the supervised PID, signals, environment and literal args. */
    argv[0] = payload;
    execv(payload, argv);
    fprintf(stderr, "Animama document worker: cannot start payload: %s\n", strerror(errno));
    return 126;
}
