import sys
sys.path.append('../build_tools/scripts')
import os
import base
import subprocess
import ctypes
import checks_develop as check
import shutil

def is_admin():
  try:
    return ctypes.windll.shell32.IsUserAnAdmin()
  except:
    return False

def installingProgram(sProgram, sParam = ''):
  if (sProgram == 'Node.js'):
    print("Installing Node.js...")
    base.download("https://nodejs.org/dist/latest-v10.x/node-v10.22.1-x64.msi", './nodejs.msi')
    code = subprocess.call('msiexec.exe /i nodejs.msi /qn',  stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    if (code == 0):
      print("Install success!")
      base.delete_file('./nodejs.msi')
      return True
    else:
      print("Error!")
      base.delete_file('./nodejs.msi')
      return False
  elif (sProgram == 'Java'):
    print("Installing Java...")
    base.download("https://javadl.oracle.com/webapps/download/AutoDL?BundleId=242990_a4634525489241b9a9e1aa73d9e118e6", './java.exe')
    code = subprocess.call('java.exe /s',  stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    if (code == 0):
      print("Install success!")
      base.delete_file('./java.exe')
      return True
    else:
      print("Error!")
      base.delete_file('./java.exe')
      return False
  elif (sProgram == 'RabbitMQ'):
    print("Installing RabbitMQ...")
    base.download("https://github.com/rabbitmq/rabbitmq-server/releases/download/v3.8.8/rabbitmq-server-3.8.8.exe", './rabbitmq.exe')
    code = subprocess.call('rabbitmq.exe /S',  stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    if (code == 0):
      print("Install success!")
      base.delete_file('./rabbitmq.exe')
      return True
    else:
      print("Error!")
      base.delete_file('./rabbitmq.exe')
      return False
  elif (sProgram == 'Erlang'):
    print("Installing Erlang...")
    base.download("http://erlang.org/download/otp_win64_23.0.exe", './erlang.exe')
    code = subprocess.call('erlang.exe /S',  stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    if (code == 0):
      print("Install success!")
      base.delete_file('./erlang.exe')
      return True
    else:
      print("Error!")
      base.delete_file('./erlang.exe')
      return False
  elif (sProgram == 'ERLANG_HOME'):
    code = subprocess.call('SETX /M ERLANG_HOME "' + check.get_erlangPath() + '"')
    if (code == 0):
      return True
    else:
      return False
  elif (sProgram == 'GruntCli'):
    print('Installing Grunt-Cli...')
    code = subprocess.call('npm install -g grunt-cli',  stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    if (code == 0):
      print("Install success!")
      return True
    else:
      print("Error!")
      return False
  elif (sProgram == 'MySQLInstaller'):
    print('Installing MySQL Installer...')
    base.download("https://dev.mysql.com/get/Downloads/MySQLInstaller/mysql-installer-web-community-8.0.21.0.msi", './mysqlinstaller.msi')
    code = subprocess.call('msiexec.exe /i mysqlinstaller.msi /qn',  stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    if (code == 0):
      print("Install success!")
      base.delete_file('./mysqlinstaller.msi')
      return True
    else:
      print("Error!")
      base.delete_file('./mysqlinstaller.msi')
      return False
  elif (sProgram == 'MySQLServer'):
    print('Installing MySQL Server...')
    code = subprocess.call('cd ' + os.path.abspath(os.sep) + 'Program Files (x86)\MySQL\MySQL Installer for Windows && MySQLInstallerConsole.exe community install server;8.0.21;x64:*:type=config;openfirewall=true;generallog=true;binlog=true;serverid=3306;enable_tcpip=true;port=3306;rootpasswd=onlyoffice -silent',  stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    if (code == 0):
      print("Install success!")
      return True
    else:
      print("Error!")
      return False
  elif (sProgram == 'MySQLDatabase'):
    print('Setting database...')
    subprocess.call('cd ' + sParam + 'bin && mysql -u root -ponlyoffice -e "source ' + os.getcwd() + '\schema\mysql\createdb.sql"', stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    return True
  elif (sProgram == 'MySQLEncrypt'):
    print('Setting MySQL password encrypting...')
    subprocess.call('cd ' + sParam + 'bin && mysql -u root -ponlyoffice -e "' + "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'onlyoffice';" + '"', stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    return True   
  elif (sProgram == "BuildTools"):
    print('Installing Build Tools...')
    base.download("https://download.visualstudio.microsoft.com/download/pr/11503713/e64d79b40219aea618ce2fe10ebd5f0d/vs_BuildTools.exe", './vs_BuildTools.exe')
    code = subprocess.call('vs_buildtools.exe --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --quiet --wait',  stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    if (code == 0):
      print("Install success!")
      base.delete_file('./vs_buildtools.exe')
      return True
    else:
      print("Error!")
      base.delete_file('./vs_buildtools.exe')
      return False

def deleteProgram(sName):
  if (sName == 'Erlang'):
    print("Deleting " + sName + "...")
    code = subprocess.call('cd ' + check.get_erlangPath() + ' && Uninstall.exe /S', stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    if (code == 0):
      print("Delete success!")
      return True
    else:
      print("Error!")
      return False
  
  if is_admin():
    print("Deleting " + sName + "...")
    code = subprocess.call('wmic product where name="' + sName + '" call uninstall',  stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    if (code == 0):
      print("Delete success!")
      return True
    else:
      print("Error!")
      return False
  else:
    ctypes.windll.shell32.ShellExecuteW(None, u"runas", unicode(sys.executable), unicode(''.join(sys.argv)), None, 1)
    sys.exit() 

def installMySQLServer():
  installingProgram('MySQLServer')
  mysqlPaths    = check.get_mysqlServersPaths()
  mysqlVersions = check.get_mysqlServersVersions()

  for i in range(len(mysqlVersions)):
    if (mysqlVersions[i] == '8.0.21'):
      print('Setting MySQL database...')
      subprocess.call('cd ' + mysqlPaths[i] + 'bin && mysql -u root -ponlyoffice -e "source ' + os.getcwd() + '\schema\mysql\createdb.sql"', stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
      subprocess.call('cd ' + mysqlPaths[i] + 'bin && mysql -u root -ponlyoffice -e "' + "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'onlyoffice';" + '"', stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
      print('MySQL Server ' + mysqlVersions[i][0:3] + ' is valid')
      return True
  return False
  
try:
  checkResults = check.check_all()
  if (len(checkResults['Install']) > 0):
    if is_admin():
      for i in range(len(checkResults['Uninstall'])):
        deleteProgram(checkResults['Uninstall'][i])
      for i in range(len(checkResults['Paths'])):
        shutil.rmtree(checkResults['Paths'][i])
      for i in range(len(checkResults['Install'])):
        if (checkResults['Install'][i] == 'MySQLDatabase' or checkResults['Install'][i] == 'MySQLEncrypt'):
          installingProgram(checkResults['Install'][i], checkResults['MySQLServer'])
        elif (checkResults['Install'][i] == 'MySQLServer'):
          installMySQLServer()
        else:
          installingProgram(checkResults['Install'][i])
    else:
      ctypes.windll.shell32.ShellExecuteW(None, unicode("runas"), unicode(sys.executable), unicode(''.join(sys.argv)), None, 1)
      sys.exit(0)
  else:
    base.print_info('All checks complite')
except SystemExit:
  input("Ignoring SystemExit. Press Enter to continue...")

