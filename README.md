# Legacy SQL Trace Profiler 1.0

macOS용 VS Code에서 SQL Server의 Legacy SQL Trace를 실시간으로 확인하는 Extension입니다. Extended Events 권한 없이 `ALTER TRACE` 권한과 `sp_trace_*` 계열을 사용합니다.

## V1 기능

- 여러 SQL Server 연결 프로필 저장, 선택, 수정, 삭제
- 기본 DB 로그인 및 선택적인 Trace 전용 로그인
- 비밀번호를 포함한 프로필 JSON 가져오기·내보내기
- RPC, SQL Batch, SQL Statement, Stored Procedure 이벤트의 Starting·Completed 선택
- TextData, LoginName, DatabaseName, ApplicationName, HostName, SPID, Duration, Reads, Writes, CPU 서버 필터
- 시작, 정지, 재개, 종료 및 종료 후 결과 유지
- 행 번호, EventClass, TextData, LoginName 실시간 목록
- 캡처 후 TextData, EventClass, LoginName 화면 필터
- SQL 전문, 간단한 구문 강조, 보기용 줄바꿈 정리, 원문 복사

## 설치 및 실행

1. VS Code의 Extensions 화면에서 `...` → `Install from VSIX...`를 선택합니다.
2. `legacy-sql-trace-profiler-1.0.0.vsix`를 선택합니다.
3. 명령 팔레트에서 `Legacy SQL Trace Profiler: Open Profiler`를 실행합니다.
4. 연결 프로필을 저장하고 이벤트·필터를 선택한 뒤 시작합니다.

기본 계정에 `ALTER TRACE` 권한이 없다면 프로필에서 별도 Trace 전용 계정을 켭니다. 정지는 서버 Trace의 신규 수집을 멈추고, 시작을 다시 누르면 기존 결과를 유지한 채 재개합니다. 종료는 서버 Trace 자원을 제거하지만 화면의 결과는 유지합니다.

## 프로필 JSON

```json
{
  "version": 1,
  "profiles": [
    {
      "id": "sample",
      "name": "DEV",
      "server": "sql.example.local",
      "port": 1433,
      "database": "SampleDb",
      "user": "app_user",
      "password": "plain-text-password",
      "useTraceCredentials": true,
      "traceUser": "trace_user",
      "tracePassword": "plain-text-trace-password",
      "encrypt": true,
      "trustServerCertificate": true
    }
  ]
}
```

사용자 요구사항에 따라 비밀번호는 JSON에 평문으로 저장되며 내보낸 파일에도 포함됩니다.

## 개발

```text
npm install
npm test
npm run build
npm run package
```

F5로 Extension Development Host를 실행할 수도 있습니다.

## 현재 검증 범위

Trace 바이너리 디코딩과 이벤트 조립은 자동 테스트합니다. 실제 SQL Server 연결·권한·이벤트 수신은 대상 서버에서 확인해야 합니다. `sp_trace_getdata`는 SQL Server의 비공개 스트림 인터페이스이므로 서버 버전에 따른 호환성 확인이 필요합니다.
