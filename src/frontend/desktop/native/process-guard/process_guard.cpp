// animama-process-guard: run one Animama sidecar inside a kill-on-close Job
// Object so that no owned process outlives the desktop app.
//
// Usage: animama-process-guard.exe -- <absolute executable> [arguments...]
//
// 1. The child starts suspended in its own process group, is assigned to the
//    job, and only then runs. Everything it starts joins the job too.
// 2. Before resuming the child, the guard writes one line to stdout:
//    "animama-process-guard pid=<child pid>". The child's own output follows.
// 3. Standard input is the lifeline. When it reaches end of file (Electron
//    closed it, exited or crashed), the guard sends CTRL_BREAK_EVENT to the
//    child's process group and terminates the job if it is still running after
//    10 seconds. Electron kills the guard itself after 15.
// 4. If the guard itself is killed, closing its job handle kills the job.
// 5. When the child exits, anything it left running in the job is terminated
//    and the guard exits with the child's exit code.
//
// Secrets reach the child only through the inherited environment.

#include <windows.h>

#include <cstdio>
#include <cwchar>
#include <string>
#include <vector>

namespace {

constexpr DWORD kGraceMilliseconds = 10000;
constexpr int kUsageError = 2;
constexpr int kStartError = 3;

// Quote one argument by the rules CommandLineToArgvW and the MSVC CRT use.
std::wstring QuoteArgument(const std::wstring& argument) {
  if (!argument.empty() &&
      argument.find_first_of(L" \t\n\v\"") == std::wstring::npos)
    return argument;
  std::wstring quoted = L"\"";
  for (size_t i = 0;; ++i) {
    size_t backslashes = 0;
    while (i < argument.size() && argument[i] == L'\\') {
      ++i;
      ++backslashes;
    }
    if (i == argument.size()) {
      quoted.append(backslashes * 2, L'\\');
      break;
    }
    if (argument[i] == L'"') {
      quoted.append(backslashes * 2 + 1, L'\\');
    } else {
      quoted.append(backslashes, L'\\');
    }
    quoted.push_back(argument[i]);
  }
  quoted.push_back(L'"');
  return quoted;
}

void Fail(const wchar_t* message) {
  fwprintf(stderr, L"animama-process-guard: %ls (error %lu)\n", message,
           GetLastError());
}

struct Lifeline {
  HANDLE job;
  DWORD child_process_group;
};

// Wait for Electron to close standard input, then stop the child: first a
// console break, then the job.
DWORD WINAPI WatchLifeline(LPVOID parameter) {
  const Lifeline* lifeline = static_cast<const Lifeline*>(parameter);
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  char buffer[64];
  DWORD read = 0;
  while (ReadFile(input, buffer, sizeof buffer, &read, nullptr) && read > 0) {
  }
  GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, lifeline->child_process_group);
  Sleep(kGraceMilliseconds);
  TerminateJobObject(lifeline->job, 1);
  return 0;
}

HANDLE Inheritable(HANDLE handle) {
  HANDLE copy = nullptr;
  if (handle == nullptr || handle == INVALID_HANDLE_VALUE ||
      !DuplicateHandle(GetCurrentProcess(), handle, GetCurrentProcess(), &copy,
                       0, TRUE, DUPLICATE_SAME_ACCESS))
    return nullptr;
  return copy;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  if (argc < 3 || std::wcscmp(argv[1], L"--") != 0) {
    fwprintf(stderr,
             L"usage: animama-process-guard.exe -- <executable> [args...]\n");
    return kUsageError;
  }

  HANDLE job = CreateJobObjectW(nullptr, nullptr);
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (job == nullptr ||
      !SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits,
                               sizeof limits)) {
    Fail(L"could not create the job object");
    return kStartError;
  }

  std::wstring command = QuoteArgument(argv[2]);
  for (int i = 3; i < argc; ++i) command += L" " + QuoteArgument(argv[i]);

  // The child inherits only its output handles and a NUL input, never the
  // lifeline, so it cannot hold the guard's stop signal open.
  SECURITY_ATTRIBUTES inherit = {sizeof inherit, nullptr, TRUE};
  HANDLE input = CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ, &inherit,
                             OPEN_EXISTING, 0, nullptr);
  HANDLE output = Inheritable(GetStdHandle(STD_OUTPUT_HANDLE));
  HANDLE error = Inheritable(GetStdHandle(STD_ERROR_HANDLE));
  if (input == INVALID_HANDLE_VALUE || output == nullptr || error == nullptr) {
    Fail(L"could not prepare the child's standard handles");
    return kStartError;
  }
  HANDLE handles[] = {input, output, error};
  SIZE_T size = 0;
  InitializeProcThreadAttributeList(nullptr, 1, 0, &size);
  std::vector<unsigned char> storage(size);
  auto attributes =
      reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
  if (!InitializeProcThreadAttributeList(attributes, 1, 0, &size) ||
      !UpdateProcThreadAttribute(attributes, 0,
                                 PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handles,
                                 sizeof handles, nullptr, nullptr)) {
    Fail(L"could not restrict inherited handles");
    return kStartError;
  }
  STARTUPINFOEXW startup = {};
  startup.StartupInfo.cb = sizeof startup;
  startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  startup.StartupInfo.hStdInput = input;
  startup.StartupInfo.hStdOutput = output;
  startup.StartupInfo.hStdError = error;
  startup.lpAttributeList = attributes;

  PROCESS_INFORMATION child = {};
  if (!CreateProcessW(argv[2], command.data(), nullptr, nullptr, TRUE,
                      CREATE_SUSPENDED | CREATE_NEW_PROCESS_GROUP |
                          CREATE_UNICODE_ENVIRONMENT |
                          EXTENDED_STARTUPINFO_PRESENT,
                      nullptr, nullptr, &startup.StartupInfo, &child)) {
    Fail(L"could not start the child");
    return kStartError;
  }
  DeleteProcThreadAttributeList(attributes);
  CloseHandle(input);
  CloseHandle(output);
  CloseHandle(error);
  if (!AssignProcessToJobObject(job, child.hProcess)) {
    Fail(L"could not assign the child to the job");
    TerminateProcess(child.hProcess, kStartError);
    return kStartError;
  }

  char handshake[64];
  int length = std::snprintf(handshake, sizeof handshake,
                             "animama-process-guard pid=%lu\n",
                             child.dwProcessId);
  DWORD written = 0;
  if (!WriteFile(GetStdHandle(STD_OUTPUT_HANDLE), handshake, length, &written,
                 nullptr)) {
    Fail(L"could not report the child process");
    TerminateJobObject(job, kStartError);
    return kStartError;
  }

  Lifeline lifeline = {job, child.dwProcessId};
  HANDLE watcher =
      CreateThread(nullptr, 0, WatchLifeline, &lifeline, 0, nullptr);
  if (watcher == nullptr) {
    Fail(L"could not watch standard input");
    TerminateJobObject(job, kStartError);
    return kStartError;
  }
  ResumeThread(child.hThread);
  CloseHandle(child.hThread);

  // Processes the child started never outlive it.
  WaitForSingleObject(child.hProcess, INFINITE);
  DWORD exit_code = kStartError;
  GetExitCodeProcess(child.hProcess, &exit_code);
  TerminateJobObject(job, exit_code);
  return static_cast<int>(exit_code);
}
